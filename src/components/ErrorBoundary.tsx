import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './Icon'

type Props = {
  children: ReactNode
  fallbackTitle?: string
  onReset?: () => void
}

type State = {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled render error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onReset) {
      this.props.onReset()
    } else {
      window.location.href = '/'
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fe-autocomplete-container" style={{ padding: '40px 20px' }}>
          <div className="fe-empty-state" style={{ margin: '40px auto', maxWidth: 640 }}>
            <div className="fe-empty-state__icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
              <Icon name="error" />
            </div>
            <h2>{this.props.fallbackTitle || '页面组件加载发生异常'}</h2>
            <p style={{ color: '#64748b', fontSize: 13.5, marginBottom: 16 }}>
              {this.state.error?.message || '组件在渲染阶段发生意外错误，已由安全边界捕获并保护。'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
              <button
                type="button"
                className="control-primary"
                onClick={this.handleReset}
              >
                <Icon name="arrow_back" />
                <span>返回工作台</span>
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
