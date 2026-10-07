/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const APP_URL = 'https://portal.firmcop.com'
interface Props { reference?: string; employeeName?: string; netPay?: string; payDate?: string; payslipId?: string }

const Email = ({ reference, employeeName, netPay, payDate, payslipId }: Props) => (
  <Html lang="en"><Head /><Preview>Payment confirmation — {reference ?? ''}</Preview>
    <Body style={main}><Container style={container}>
      <Heading style={h1}>Payment completed</Heading>
      <Text style={text}>Hi {employeeName ?? 'there'}, your payslip <strong>{reference ?? '—'}</strong> has been paid.</Text>
      <Text style={text}>Net amount: <strong>{netPay ?? '—'}</strong>{payDate ? ` on ${payDate}` : ''}.</Text>
      <Section style={{ margin: '24px 0' }}>
        <Button href={`${APP_URL}/hrm/payslips/${payslipId ?? ''}`} style={button}>View payslip</Button>
      </Section>
    </Container></Body></Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Payment confirmation: ${d.reference ?? ''}`,
  displayName: 'Payslip paid',
  previewData: { reference: 'PSL-202605-0001', employeeName: 'Jane Doe', netPay: 'USD 1,200.00', payDate: '2026-05-31', payslipId: 'abc' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#1e3a5f', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 14px' }
const button = { backgroundColor: '#1e3a5f', color: '#fff', padding: '12px 24px', borderRadius: '8px', fontSize: '15px', fontWeight: 600, textDecoration: 'none', display: 'inline-block' }
