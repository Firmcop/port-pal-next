/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as welcome } from './welcome.tsx'
import { template as staffInvite } from './staff-invite.tsx'
import { template as payslipSubmitted } from './payslip-submitted-for-approval.tsx'
import { template as payslipApproved } from './payslip-approved.tsx'
import { template as payslipRejected } from './payslip-rejected.tsx'
import { template as payslipPaid } from './payslip-paid.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  welcome,
  'staff-invite': staffInvite,
  'payslip-submitted-for-approval': payslipSubmitted,
  'payslip-approved': payslipApproved,
  'payslip-rejected': payslipRejected,
  'payslip-paid': payslipPaid,
}
