/// <reference types="vite/client" />

import type { CapWidget } from 'cap-widget'
import type { DetailedHTMLProps, HTMLAttributes, Ref } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'cap-widget': DetailedHTMLProps<HTMLAttributes<CapWidget>, CapWidget> & {
        'data-cap-api-endpoint': string
        'data-cap-disable-haptics'?: string
        'data-cap-i18n-error-aria-label'?: string
        'data-cap-i18n-error-label'?: string
        'data-cap-i18n-initial-state'?: string
        'data-cap-i18n-required-label'?: string
        'data-cap-i18n-solved-label'?: string
        'data-cap-i18n-verified-aria-label'?: string
        'data-cap-i18n-verify-aria-label'?: string
        'data-cap-i18n-verifying-aria-label'?: string
        'data-cap-i18n-verifying-label'?: string
        ref?: Ref<CapWidget>
        required?: boolean
      }
    }
  }
}
