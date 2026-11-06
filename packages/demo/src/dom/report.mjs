/**
 * 检查脚本的统一"记账本"（D-103）。
 *
 * 之前 12 个 verify / dom 脚本各自写了一遍
 * `checks.push([name, Boolean(pass)])` + 结尾的 ✔/✖ 汇总 + `process.exit`，
 * 输出格式一旦不一致就没法比较前后结果。这里收成一份。
 */

/** 创建一个记录器；`check(名称, 断言值)` */
export function createChecks(label = '') {
  const rows = [];
  return {
    rows,
    label,
    /** 记一项；返回断言结果本身，方便 `if (check(...))` */
    check(name, pass) {
      const ok = Boolean(pass);
      rows.push([name, ok]);
      return ok;
    },
    get failed() { return rows.filter(([, ok]) => !ok); },
    get passed() { return rows.filter(([, ok]) => ok); },
    /** 打印逐项结果 + 汇总；返回是否全过 */
    report(out = console.log, err = console.error) {
      for (const [name, ok] of rows) (ok ? out : err)(`${ok ? '✔' : '✖'} ${name}`);
      out(`\n共 ${rows.length} 项，${this.passed.length} 通过`);
      return this.failed.length === 0;
    },
    /** 打印并以退出码收尾 */
    finish() {
      const ok = this.report();
      process.exit(ok ? 0 : 1);
    },
  };
}
