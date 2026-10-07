/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const APP_URL = 'https://portal.firmcop.com'
interface Props { reference?: string; employeeName?: string; approver?: string; comment?: string; payslipId?: string }

const Email = ({ reference, employeeName, approver, comment, payslipId }: Props) => (
  <Html lang="en"><Head /><Preview>Payslip approved — {reference ?? ''}</Preview>
    <Body style={main}><Container style={container}>
      <Heading style={h1}>Payslip approved</Heading>
      <Text style={text}>Payslip <strong>{reference ?? '—'}</strong> for <strong>{employeeName ?? 'employee'}</strong> was approved by {approver ?? 'a manager'}. It is ready to be posted.</Text>
      {comment ? <Text style={quote}>“{comment}”</Text> : null}
      <Section style={{ margin: '24px 0' }}>
        <Button href={`${APP_URL}/hrm/payslips/${payslipId ?? ''}`} style={button}>Open payslip</Button>
      </Section>
    </Container></Body></Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Approved: payslip ${d.reference ?? ''}`,
  displayName: 'Payslip approved',
  previewData: { reference: 'PSL-202605-0001', employeeName: 'Jane Doe', approver: 'Alex', comment: 'Looks good', payslipId: 'abc' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#065f46', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 14px' }
const quote = { fontSize: '14px', color: '#475569', borderLeft: '3px solid #10b981', padding: '6px 12px', background: '#ecfdf5', margin: '0 0 14px' }
const button = { backgroundColor: '#10b981', color: '#fff', padding: '12px 24px', borderRadius: '8px', fontSize: '15px', fontWeight: 600, textDecoration: 'none', display: 'inline-block' }
