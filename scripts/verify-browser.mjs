import { chromium } from "playwright";
import { readFile, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const out = resolve("artifacts/browser");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const report = { checks: [], screens: [], errors: [], font: [], network: [] };
function check(name, condition = true) {
  assert.ok(condition, name);
  report.checks.push(name);
}
const mode = process.env.TEST_MODE || "offline";
let cleanup = async () => {};
let target = process.env.TEST_URL;
if (!target && mode === "server") {
  const { createServer } = await import("../server.mjs");
  const dir = await mkdtemp(tmpdir() + "/weekly-field-browser-");
  const server = createServer({
    dbPath: dir + "/state.sqlite",
    staticDir: resolve("dist"),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  target = `http://127.0.0.1:${server.address().port}`;
  cleanup = () => new Promise((r) => server.close(r));
}
if (!target)
  target = pathToFileURL(resolve("artifacts/주간포장계획_작동초안.html")).href;
const httpCredentials = process.env.TEST_AUTH_FILE
  ? JSON.parse(await readFile(process.env.TEST_AUTH_FILE, "utf8"))
  : undefined;
const context = await browser.newContext({
  ...(httpCredentials ? { httpCredentials } : {}),
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("request", (r) => {
  if (/^https?:/.test(r.url())) report.network.push(r.url());
});
async function state() {
  return page
    .evaluate(async () =>
      globalThis.__OFFLINE_DRAFT__
        ? JSON.parse(localStorage.getItem("weekly-field-plan-draft-v1"))
        : await (await fetch("/api/state")).json(),
    )
    .then((s) => s?.state || s);
}
async function clickNav(name) {
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name, exact: true })
    .click();
}
async function submitDialog() {
  await page.getByRole("button", { name: "계획 입력", exact: true }).click();
  await page.getByRole("dialog").waitFor();
}
try {
  await page.goto(target);
  await page.getByRole("heading", { name: "주간 계획", exact: true }).waitFor();
  check(
    "empty start visible",
    await page
      .getByText("아직 등록된 계획이 없습니다", { exact: true })
      .isVisible(),
  );
  check(
    "Kakao disconnected label",
    (await page.locator(".connection").innerText()) === "카카오 미연결",
  );
  await clickNav("취합 대상");
  for (const name of ["검증 연구원 가", "검증 연구원 나", "검증 연구원 다"]) {
    await page.getByLabel("추가할 제출자 이름").fill(name);
    await page.getByRole("button", { name: "추가", exact: true }).click();
    await page.locator(".roster").getByText(name, { exact: true }).waitFor();
  }
  check("real member save", (await state()).members.length === 3);
  await clickNav("주간 계획");
  const week = await page.getByLabel("조회할 주 선택").inputValue();
  await submitDialog();
  await page
    .getByRole("dialog")
    .getByLabel("제출자", { exact: true })
    .selectOption({ label: "검증 연구원 가" });
  await page
    .getByLabel("카톡 계획 원문", { exact: true })
    .fill(
      "다음 주 포장 계획입니다.\n월요일 오전 / 시험포장 A / 제초 / 담당: 검증 연구원 가\n수요일 오후 / 시험포장 B / 토양 시료 채취 / 담당: 검증 연구원 가, 검증 연구원 나 / 비고: 운반차 필요",
    );
  await page.getByRole("button", { name: "항목으로 정리" }).click();
  check("parse two rows", (await page.locator(".preview-item").count()) === 2);
  check(
    "source names parsed",
    (
      await page.getByLabel("작업 2 담당자", { exact: true }).inputValue()
    ).includes("검증 연구원 나"),
  );
  if (mode === "server") {
    let drop = true;
    await page.route("**/api/commands", async (route) => {
      const cmd = route.request().postDataJSON();
      if (drop && cmd.type === "submit") {
        drop = false;
        const real = await route.fetch();
        assert.equal(real.status(), 200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "확인한 계획 저장" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "서버 응답을 받지 못했습니다" })
      .waitFor();
    check("lost HTTP response reports uncertainty");
  }
  await page.getByRole("button", { name: "확인한 계획 저장" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  check("two plans persisted", (await state()).plans.length === 2);
  if (mode === "server") {
    check(
      "retry did not duplicate committed submission",
      (await state()).plans.length === 2,
    );
    await page.unroute("**/api/commands");
  }
  await page.reload();
  await page.locator(".plan-row").first().waitFor();
  check(
    "reload preserves plans",
    (await page.locator(".plan-row").count()) === 2,
  );
  await submitDialog();
  await page
    .getByRole("dialog")
    .getByLabel("제출자", { exact: true })
    .selectOption({ label: "검증 연구원 나" });
  await page.getByRole("button", { name: "작업 없음", exact: true }).click();
  await page.getByRole("button", { name: "작업 없음으로 제출" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await clickNav("제출 현황");
  check(
    "no-work distinct",
    await page
      .locator(".submission-row")
      .filter({ hasText: "검증 연구원 나" })
      .getByText("작업 없음", { exact: true })
      .isVisible(),
  );
  check(
    "missing distinct",
    await page
      .locator(".submission-row")
      .filter({ hasText: "검증 연구원 다" })
      .getByText("미제출", { exact: true })
      .isVisible(),
  );
  await clickNav("취합·공지");
  await page.getByRole("button", { name: "현재 취합 확정" }).click();
  await page.getByRole("button", { name: "확정본 저장" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  check("snapshot frozen", (await state()).snapshots.length === 1);
  const frozen = (await state()).snapshots[0].notice;
  await clickNav("주간 계획");
  await page.locator(".plan-row").filter({ hasText: "토양 시료 채취" }).click();
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("시간", { exact: true })
    .fill("오전 10시");
  await page
    .getByRole("dialog")
    .getByLabel("담당자", { exact: true })
    .fill("검증 연구원 가, 검증 연구원 나");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  check(
    "edit persisted",
    (await state()).plans.find((p) => p.task === "토양 시료 채취").time ===
      "오전 10시",
  );
  check(
    "source retained",
    (await state()).plans
      .find((p) => p.task === "토양 시료 채취")
      .sourceText.includes("수요일 오후"),
  );
  check("snapshot immutable", (await state()).snapshots[0].notice === frozen);
  await clickNav("취합·공지");
  check(
    "changed visible",
    await page
      .getByRole("heading", { name: "확정 후 변경되었습니다" })
      .isVisible(),
  );
  check(
    "current notice reflects change",
    (await page.getByLabel("공지문", { exact: true }).inputValue()).includes(
      "오전 10시",
    ),
  );
  await page
    .getByRole("button", { name: "마지막 확정본", exact: true })
    .click();
  check(
    "old notice unchanged",
    (await page.getByLabel("공지문", { exact: true }).inputValue()) === frozen,
  );
  await page.getByRole("button", { name: "현재 취합안", exact: true }).click();
  let pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "현재 계획 CSV" }).click();
  let dl = await pending;
  await dl.saveAs(out + `/${mode}-plans.csv`);
  const csv = await readFile(out + `/${mode}-plans.csv`, "utf8");
  check(
    "real CSV download",
    csv.startsWith("\uFEFF") &&
      csv.includes("오전 10시") &&
      csv.includes("검증 연구원 가"),
  );
  pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "공지문 TXT" }).click();
  dl = await pending;
  await dl.saveAs(out + `/${mode}-notice.txt`);
  check(
    "real TXT download",
    (await readFile(out + `/${mode}-notice.txt`, "utf8")).includes("오전 10시"),
  );
  await clickNav("주간 계획");
  await page.locator(".plan-row").filter({ hasText: "제초" }).click();
  await page.getByRole("button", { name: "계획 취소", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "계획 취소", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  check(
    "cancel excludes current",
    (await page.locator(".plan-row").count()) === 1,
  );
  await page.getByLabel("계획 상태 필터").selectOption("cancelled");
  await page.locator(".plan-row").first().click();
  await page.getByRole("button", { name: "취소 복구", exact: true }).click();
  await page.getByRole("button", { name: "계획 복구", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("계획 상태 필터").selectOption("active");
  check("restore works", (await page.locator(".plan-row").count()) === 2);
  await page.getByRole("button", { name: "다음 주", exact: true }).click();
  check("week isolated", (await page.locator(".plan-row").count()) === 0);
  await page.getByRole("button", { name: "이전 주", exact: true }).click();
  check(
    "week return restores",
    (await page.locator(".plan-row").count()) === 2,
  );
  for (const name of ["담당자별", "포장별", "요일별"]) {
    await page.getByRole("button", { name, exact: true }).click();
    check("group " + name, (await page.locator(".plan-row").count()) > 0);
  }
  await page.evaluate(() => document.fonts.ready);
  const cdp = await context.newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const doc = await cdp.send("DOM.getDocument");
  const n = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: "h1",
  });
  report.font = await cdp.send("CSS.getPlatformFontsForNode", {
    nodeId: n.nodeId,
  });
  check(
    "real Pretendard font",
    report.font.fonts.some(
      (f) => f.familyName.includes("Pretendard") && f.isCustomFont,
    ),
  );
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(100);
    for (const route of ["주간 계획", "제출 현황", "취합·공지", "취합 대상"]) {
      await clickNav(route);
      check(
        `no overflow ${width} ${route}`,
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
    }
    await clickNav("주간 계획");
    if (width === 1440 || width === 390) {
      const filename = out + `/${mode}-${width}.png`;
      await page.screenshot({ path: filename, fullPage: true });
      report.screens.push(filename);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await submitDialog();
  check(
    "mobile dialog fits",
    await page
      .getByRole("dialog")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().right <= innerWidth &&
          el.getBoundingClientRect().left >= 0,
      ),
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  check("no page errors", report.errors.length === 0);
  if (mode === "offline")
    check("offline zero HTTP requests", report.network.length === 0);
  report.pass = true;
  report.count = report.checks.length;
  await writeFile(
    out + `/${mode}-verification.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      pass: true,
      mode,
      checks: report.count,
      screens: report.screens,
      font: report.font,
      errors: report.errors,
    }),
  );
} catch (e) {
  report.failure = e.stack;
  await page
    .screenshot({ path: out + `/${mode}-failure.png`, fullPage: true })
    .catch(() => {});
  await writeFile(
    out + `/${mode}-verification.json`,
    JSON.stringify(report, null, 2),
  );
  throw e;
} finally {
  await context.close();
  await browser.close();
  await cleanup();
}
