const form = document.querySelector('#setup');
const button = document.querySelector('#submit');
const error = document.querySelector('#error');
try {
  const state = await window.desktopSetup.state();
  if (state.workspaces.length) {
    document.querySelector('#legacy').hidden = false;
    const select = document.querySelector('#workspace');
    for (const [index, item] of state.workspaces.entries()) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `工作空间 ${index + 1} · ${item.papers} 篇稿件 · ${item.createdAt.slice(0, 10)}`;
      select.append(option);
    }
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '新建空白工作空间';
    select.append(empty);
  }
  button.disabled = !state.required;
} catch {
  error.textContent = '无法读取本机数据，请关闭后重新启动。';
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  if (form.password.value !== form.confirmation.value) {
    error.textContent = '两次输入的密码不一致。';
    return;
  }
  button.disabled = true;
  try {
    const result = await window.desktopSetup.create({
      username: form.username.value,
      password: form.password.value,
      workspaceId: form.workspace.value || undefined,
    });
    if (!result.ok) throw new Error(result.error);
    form.reset();
  } catch (issue) {
    error.textContent = issue.message || '创建失败，请重试。';
    button.disabled = false;
  }
});
