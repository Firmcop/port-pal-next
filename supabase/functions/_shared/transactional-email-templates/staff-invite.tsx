/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Firmcop CDMS'

interface StaffInviteProps {
  inviterName?: string
  organizationName?: string
  roleLabel?: string
  acceptUrl: string
  expiresInDays?: number
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  yard_operator: 'Yard Operator',
  gate_clerk: 'Gate Clerk',
  viewer: 'Viewer',
}

const StaffInviteEmail = ({
  inviterName, organizationName, roleLabel, acceptUrl, expiresInDays = 7,
}: StaffInviteProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      You've been invited to join {organizationName ?? SITE_NAME}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You're invited to {organizationName ?? SITE_NAME}</Heading>
        <Text style={text}>
          {inviterName ? `${inviterName} has invited you` : 'You have been invited'} to join{' '}
          <strong>{organizationName ?? SITE_NAME}</strong>
          {roleLabel ? <> as <strong>{ROLE_LABELS[roleLabel] ?? roleLabel}</strong></> : null}.
        </Text>
        <Text style={text}>
          Click the button below to accept the invitation and set your password.
        </Text>
        <Section style={buttonSection}>
          <Button href={acceptUrl} style={button}>Accept invitation</Button>
        </Section>
        <Text style={small}>Or copy this link: <a href={acceptUrl} style={link}>{acceptUrl}</a></Text>
        <Text style={footer}>
          This invitation expires in {expiresInDays} days. If you weren't expecting it, you can ignore this email.
        </Text>
        <Text style={signature}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: StaffInviteEmail,
  subject: (d: Record<string, any>) =>
    `You're invited to ${d.organizationName ?? SITE_NAME}`,
  displayName: 'Staff invitation',
  previewData: {
    inviterName: 'Alex',
    organizationName: 'Acme Depot',
    roleLabel: 'admin',
    acceptUrl: 'https://portal.firmcop.com/accept-invite?token=preview',
    expiresInDays: 7,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: 'hsl(220, 25%, 10%)', margin: '0 0 20px' }
const text = { fontSize: '15px', color: 'hsl(220, 10%, 30%)', lineHeight: '1.6', margin: '0 0 16px' }
const small = { fontSize: '12px', color: 'hsl(220, 10%, 46%)', wordBreak: 'break-all' as const, margin: '0 0 16px' }
const link = { color: 'hsl(215, 90%, 42%)', textDecoration: 'underline' }
const buttonSection = { margin: '28px 0' }
const button = { backgroundColor: 'hsl(215, 90%, 42%)', color: '#ffffff', padding: '12px 24px', borderRadius: '8px', fontSize: '15px', fontWeight: '600', textDecoration: 'none', display: 'inline-block' }
const footer = { fontSize: '13px', color: 'hsl(220, 10%, 46%)', margin: '32px 0 8px' }
const signature = { fontSize: '13px', color: 'hsl(220, 10%, 46%)', margin: '0' }
