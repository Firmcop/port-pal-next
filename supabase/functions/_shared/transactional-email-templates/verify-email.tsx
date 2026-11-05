/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Port Pal'

interface VerifyProps {
  name?: string
  company?: string
  url: string
}

const VerifyEmail = ({ name, company, url }: VerifyProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email to keep using {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{name ? `Welcome, ${name}` : 'Welcome to Port Pal'}</Heading>
        <Text style={text}>
          {company ? `${company} is set up on ${SITE_NAME} and your 30-day trial has started.` : `Your ${SITE_NAME} trial has started.`}{' '}
          Please confirm this is your email address. You can keep working in the meantime; after 7 days we ask for
          confirmation before you continue.
        </Text>
        <Section style={buttonSection}>
          <Button href={url} style={button}>Confirm my email</Button>
        </Section>
        <Text style={small}>Or open this link: {url}</Text>
        <Text style={footer}>If you didn't sign up for {SITE_NAME}, ignore this email and nothing will happen.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: VerifyEmail,
  subject: 'Confirm your email for Port Pal',
  displayName: 'Email verification',
  serverOnly: true,
  previewData: { name: 'Alex', company: 'Acme Depot', url: 'https://portal.firmcop.com/verify-email?token=example' },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: 'hsl(220, 25%, 10%)', margin: '0 0 20px' }
const text = { fontSize: '15px', color: 'hsl(220, 10%, 30%)', lineHeight: '1.6', margin: '0 0 16px' }
const buttonSection = { margin: '28px 0' }
const button = {
  backgroundColor: 'hsl(215, 90%, 42%)',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '8px',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  display: 'inline-block',
}
const small = { fontSize: '12px', color: 'hsl(220, 10%, 46%)', wordBreak: 'break-all' as const, margin: '0 0 16px' }
const footer = { fontSize: '13px', color: 'hsl(220, 10%, 46%)', margin: '32px 0 0' }
