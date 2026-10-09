function createScoreboardUi() {
    return {
  page: ScoreboardPage,
  NS,
  dict: L,
  ensureCss,
  tr,
  fmtTime,
  shortSessionId,
  pageSequence,
  Pager,
  setLocale: (ctx) => { localeCtx = ctx },
  setSessions: (svc) => { sessionsSvc = svc },
    }
}
})();
