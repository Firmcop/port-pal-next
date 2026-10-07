/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const APP_URL = 'https://portal.firmcop.com'
interface Props { reference?: string; employeeName?: string; rejector?: string; comment?: string; payslipId?: string }

const Email = ({ reference, employeeName, rejector, comment, payslipId }: Props) => (
  <Html lang="en"><Head /><Preview>Payslip rejected — {reference ?? ''}</Preview>
    <Body style={main}><Container style={container}>
      <Heading style={h1}>Payslip rejected</Heading>
      <Text style={text}>Payslip <strong>{reference ?? '—'}</strong> for <strong>{employeeName ?? 'employee'}</strong> was rejected by {rejector ?? 'a manager'} and returned to draft.</Text>
      {comment ? <Text style={quote}>“{comment}”</Text> : null}
      <Section style={{ margin: '24px 0' }}>
        <Button href={`${APP_URL}/hrm/payslips/${payslipId ?? ''}`} style={button}>Edit payslip</Button>
      </Section>
    </Container></Body></Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Rejected: payslip ${d.reference ?? ''}`,
  displayName: 'Payslip rejected',
  previewData: { reference: 'PSL-202605-0001', employeeName: 'Jane Doe', rejector: 'Alex', comment: 'Adjust overtime', payslipId: 'abc' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#991b1b', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6', margin: '0 0 14px' }
const quote = { fontSize: '14px', color: '#475569', borderLeft: '3px solid #ef4444', padding: '6px 12px', background: '#fef2f2', margin: '0 0 14px' }
const button = { backgroundColor: '#1e3a5f', color: '#fff', padding: '12px 24px', borderRadius: '8px', fontSize: '15px', fontWeight: 600, textDecoration: 'none', display: 'inline-block' }
