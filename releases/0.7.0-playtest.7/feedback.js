(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const comment = $('feedback-comment'), output = $('feedback-output'), status = $('feedback-status');
  $('feedback-generate').addEventListener('click', () => {
    const snapshot = window.__crowProbe.snapshot();
    const state = snapshot.state;
    const level = state.mode === 'practice' ? '单独练习第' : '这一趟第';
    output.value = [
      '再喝一口 · 试玩反馈',
      '版本：' + $('playtest-version').textContent.trim(),
      '当前场景：' + level + (state.index + 1) + '瓶',
      '水量：' + state.water + '/' + state.cfg.waterGoal + '；本瓶已投：' + state.spent + '次',
      '整趟已投：' + state.runSpent + '次；已完成：' + snapshot.save.runsCompleted + '趟',
      '音乐：' + (snapshot.audioPreferences.music ? '开' : '关'),
      '屏幕：' + window.innerWidth + ' × ' + window.innerHeight,
      '意见：',
      comment.value.trim() || '未填写'
    ].join('\n');
    $('feedback-preview').hidden = false;
    output.scrollTop = 0;
    status.textContent = '先检查内容，再复制。';
  });
  $('feedback-copy').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(output.value);
      status.textContent = '已复制，发给邀请你试玩的人即可。';
    } catch (_) {
      status.textContent = '复制没成功，请长按或选中文字复制。';
      output.focus();
      output.select();
      output.setSelectionRange(0, output.value.length);
    }
  });
  comment.addEventListener('input', () => {
    if (!$('feedback-preview').hidden) status.textContent = '意见已修改，点击“生成反馈”更新。';
  });
})();
