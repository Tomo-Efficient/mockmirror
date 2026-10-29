import { api } from './api.js';

export function renderAuth() {
  document.body.classList.add('auth-mode');
  document.title = '登录 · 面镜 MockMirror';
  const root = document.getElementById('view');
  root.innerHTML = `<div class="auth-page">
    <section class="auth-story">
      <a class="auth-brand" href="/">
        <span class="logo-mark"></span>
        <span><strong>面镜</strong><small>MockMirror</small></span>
      </a>
      <div class="auth-story-main">
        <span class="eyebrow">AI INTERVIEW COACH</span>
        <h1>每一次面试，<br>都从你的简历开始。</h1>
        <p>登录后，简历、面试记录、个人题库和设置只属于你。换一台设备，数据也不会丢。</p>
        <ul class="auth-points">
          <li><span>01</span>简历与 JD 只对当前账号可见</li>
          <li><span>02</span>面试记录、题库、复盘报告独立保存</li>
          <li><span>03</span>模型 Key 与偏好设置按账号隔离</li>
        </ul>
      </div>
      <div class="auth-story-foot">面镜 MockMirror · 个人项目 · 2026</div>
    </section>
    <section class="auth-panel">
      <div class="auth-card">
        <div class="auth-tabs" role="tablist">
          <button class="auth-tab active" data-mode="login" role="tab" aria-selected="true">登录</button>
          <button class="auth-tab" data-mode="register" role="tab" aria-selected="false">注册</button>
        </div>
        <div class="auth-head">
          <h2 id="authTitle">欢迎回来</h2>
          <p id="authSub">继续你的下一场模拟面试。</p>
        </div>
        <form id="authForm" novalidate>
          <label class="auth-field" id="nameField" hidden>
            <span>怎么称呼你</span>
            <input class="input" name="name" maxlength="60" autocomplete="name" placeholder="例如：石浩田">
          </label>
          <label class="auth-field">
            <span>邮箱</span>
            <input class="input" name="email" type="email" maxlength="160" autocomplete="email" placeholder="you@example.com" required>
          </label>
          <label class="auth-field">
            <span>密码 <small id="pwdHint">至少 8 位</small></span>
            <input class="input" name="password" type="password" minlength="8" maxlength="128" autocomplete="current-password" placeholder="输入密码" required>
          </label>
          <p class="auth-error" id="authError" role="alert"></p>
          <button class="btn btn-primary btn-lg btn-block" type="submit" id="authSubmit">登录</button>
        </form>
        <p class="auth-switch" id="authSwitch">还没有账号？<button type="button" data-mode="register">创建一个</button></p>
        <p class="auth-note">密码使用 scrypt 加盐哈希保存；登录状态是 HttpOnly Cookie，不存 localStorage。</p>
      </div>
    </section>
  </div>`;

  let mode = 'login';
  const form = root.querySelector('#authForm');
  const title = root.querySelector('#authTitle');
  const sub = root.querySelector('#authSub');
  const nameField = root.querySelector('#nameField');
  const nameInput = form.elements.name;
  const emailInput = form.elements.email;
  const pwdInput = form.elements.password;
  const error = root.querySelector('#authError');
  const submit = root.querySelector('#authSubmit');
  const switchText = root.querySelector('#authSwitch');
  const pwdHint = root.querySelector('#pwdHint');

  const setMode = (next) => {
    mode = next;
    const register = mode === 'register';
    root.querySelectorAll('.auth-tab').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    nameField.hidden = !register;
    nameInput.required = register;
    title.textContent = register ? '创建你的账号' : '欢迎回来';
    sub.textContent = register ? '注册后，数据只属于你。' : '继续你的下一场模拟面试。';
    submit.textContent = register ? '注册并进入' : '登录';
    switchText.innerHTML = register
      ? '已经有账号？<button type="button" data-mode="login">直接登录</button>'
      : '还没有账号？<button type="button" data-mode="register">创建一个</button>';
    pwdInput.autocomplete = register ? 'new-password' : 'current-password';
    pwdHint.textContent = register ? '至少 8 位' : '至少 8 位';
    error.textContent = '';
    switchText.querySelector('button').onclick = () => setMode(mode === 'login' ? 'register' : 'login');
    (register ? nameInput : emailInput).focus();
  };

  root.querySelectorAll('.auth-tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  switchText.querySelector('button').onclick = () => setMode('register');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const email = emailInput.value.trim();
    const password = pwdInput.value;
    const name = nameInput.value.trim();
    if (!email || !password) { error.textContent = '请填写邮箱和密码'; return; }
    if (mode === 'register' && !name) { error.textContent = '请填写称呼'; return; }
    if (password.length < 8) { error.textContent = '密码至少 8 位'; return; }
    submit.disabled = true;
    const old = submit.textContent;
    submit.textContent = mode === 'register' ? '创建中…' : '登录中…';
    try {
      await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: mode === 'register' ? { name, email, password } : { email, password }
      });
      location.reload();
    } catch (err) {
      error.textContent = err.message || '操作失败，请稍后再试';
      submit.disabled = false;
      submit.textContent = old;
    }
  });
  emailInput.focus();
}
