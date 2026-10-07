/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Firmcop CDMS'
const APP_URL = 'https://portal.firmcop.com'

interface Props { reference?: string; employeeName?: string; netPay?: string; submittedBy?: string; payslipId?: string }

const Email = ({ reference, employeeName, netPay, submittedBy, payslipId }: Props) => (
  <Html lang="en"><Head /><Preview>Payslip awaiting approval — {reference ?? ''}</Preview>
    <Body style={main}><Container style={container}>
      <Heading style={h1}>Payslip awaiting your approval</Heading>
      <Text style={text}>Payslip <strong>{reference ?? '—'}</strong> for <strong>{employeeName ?? 'employee'}</strong> ({netPay ?? '—'}) was submitted by {submittedBy ?? 'a colleague'} and needs approval before it can be posted.</Text>
      <Section style={{ margin: '24px 0' }}>
        <Button href={`${APP_URL}/hrm/payslips/${payslipId ?? ''}`} style={button}>Review payslip</Button>
      </Section>
      <Text style={footer}>— The {SITE_NAME} Team</Text>
    </Container></Body></Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Approval needed: payslip ${d.reference ?? ''}`,
  displayName: 'Payslip submitted for approval',
  previewData: { reference: 'PSL-202605-0001', employeeName: 'Jane Doe', netPay: 'USD 1,200.00', submittedBy: 'HR', payslipId: 'abc' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f1729', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 14px' }
const button = { backgroundColor: '#1e3a5f', color: '#fff', padding: '12px 24px', borderRadius: '8px', fontSize: '15px', fontWeight: 600, textDecoration: 'none', display: 'inline-block' }
const footer = { fontSize: '12px', color: '#64748b', margin: '32px 0 0' }
