type AuthGateProps = {
  message?: string
  onAuthenticate: () => void
}

export default function AuthGate({ message, onAuthenticate }: AuthGateProps) {
  return (
    <main className="auth-gate">
      <section className="auth-gate__card" aria-labelledby="auth-gate-title">
        <img className="auth-gate__logo" src="/fe_logo.png" alt="" aria-hidden="true" />
        <span>FE WEB</span>
        <h1 id="auth-gate-title">作业答案工作台</h1>
        <p>{message || '登录统一账号后继续查看当前作业、历史作业和作业设置。'}</p>
        <button type="button" onClick={onAuthenticate}>前往统一认证</button>
        <a href="https://lastudio.cc/account" target="_blank" rel="noopener noreferrer">账号管理</a>
      </section>
    </main>
  )
}
