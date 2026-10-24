export default function SeoLandingPage() {
  return (
    <main className="fe-seo-landing" style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '72px 24px 56px' }}>
        <header style={{ maxWidth: 760 }}>
          <img src="/fe_logo.png" alt="Fe Web Logo" width={72} height={72} style={{ borderRadius: 18, display: 'block', marginBottom: 24 }} />
          <p style={{ margin: '0 0 12px', color: '#64748b', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>LastStudio · Fe Web</p>
          <h1 style={{ margin: 0, fontSize: 'clamp(32px, 6vw, 58px)', lineHeight: 1.08, letterSpacing: '-.04em' }}>
            科大讯飞 e听说网页版在线答案提取与作业辅助平台
          </h1>
          <p style={{ maxWidth: 720, margin: '24px 0 0', color: '#475569', fontSize: 18, lineHeight: 1.8 }}>
            Fe Web（Fuck_ets100 网页版）提供免安装的浏览器工作台，用于查看 e听说作业、整理试卷结构、阅读答案解析，并在符合服务规则的前提下使用作业辅助功能。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 28 }}>
            <a href="/app" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: '#0f172a', color: '#fff', padding: '12px 20px', textDecoration: 'none', fontWeight: 700 }}>
              进入 Fe Web 工作台
            </a>
            <a href="https://lastudio.cc/download/fe/" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, border: '1px solid #cbd5e1', color: '#334155', padding: '12px 20px', textDecoration: 'none', fontWeight: 700 }}>
              查看 Fe Android 版
            </a>
          </div>
        </header>

        <section aria-labelledby="fe-features" style={{ marginTop: 72 }}>
          <h2 id="fe-features" style={{ margin: 0, fontSize: 28 }}>主要功能</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 20 }}>
            {[
              ['跨平台免安装', '支持 Windows、Mac、iPad、Android 和 iOS 浏览器，打开网页即可使用。'],
              ['作业与试卷阅读', '同步当前及历史作业，按题目和试题部分整理内容，方便课后复习。'],
              ['答案辅助参考', '支持听说信息、回答问题、信息转述、短文朗读和模拟考试等题型的内容查看。'],
            ].map(([title, description]) => (
              <article key={title} style={{ border: '1px solid #e2e8f0', borderRadius: 20, background: '#fff', padding: 22, boxShadow: '0 12px 30px rgba(15, 23, 42, .05)' }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
                <p style={{ margin: '10px 0 0', color: '#64748b', lineHeight: 1.7 }}>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="fe-usage" style={{ marginTop: 56, maxWidth: 760 }}>
          <h2 id="fe-usage" style={{ margin: 0, fontSize: 28 }}>使用说明</h2>
          <p style={{ margin: '16px 0 0', color: '#475569', lineHeight: 1.8 }}>
            首次进入工作台需要阅读并同意服务协议、隐私政策和免责声明，然后通过 LastStudio 统一认证登录。第三方账号、作业内容和语音数据只会在你主动使用对应功能时处理，解析结果仅供课后学习参考，请勿用于考试作弊。
          </p>
        </section>

        <footer style={{ marginTop: 72, paddingTop: 20, borderTop: '1px solid #e2e8f0', color: '#64748b', fontSize: 14 }}>
          <a href="https://lastudio.cc/" style={{ color: 'inherit' }}>LastStudio 官方网站</a>
          <span aria-hidden="true"> · </span>
          <a href="https://lastudio.cc/terms" style={{ color: 'inherit' }}>服务协议与免责声明</a>
        </footer>
      </div>
    </main>
  )
}
