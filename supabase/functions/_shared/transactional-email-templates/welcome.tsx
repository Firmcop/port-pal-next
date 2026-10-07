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

const SITE_NAME = 'Firmcop CDMS'
const APP_URL = 'https://portal.firmcop.com'

interface WelcomeProps {
  name?: string
}

const WelcomeEmail = ({ name }: WelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to {SITE_NAME} — your container depot workspace is ready</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {name ? `Welcome aboard, ${name}!` : 'Welcome aboard!'}
        </Heading>
        <Text style={text}>
          Your {SITE_NAME} account has been created. You now have access to
          yard inventory, gate operations, billing, and reporting — all in one
          place.
        </Text>
        <Text style={text}>
          To get started, sign in and explore your dashboard. An administrator
          will assign your role and depot access shortly if they haven't already.
        </Text>
        <Section style={buttonSection}>
          <Button href={APP_URL} style={button}>
            Open {SITE_NAME}
          </Button>
        </Section>
        <Text style={footer}>
          If you weren't expecting this email, you can safely ignore it.
        </Text>
        <Text style={signature}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomeEmail,
  subject: `Welcome to ${SITE_NAME}`,
  displayName: 'Welcome email',
  previewData: { name: 'Alex' },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: 'hsl(220, 25%, 10%)',
  margin: '0 0 20px',
}
const text = {
  fontSize: '15px',
  color: 'hsl(220, 10%, 30%)',
  lineHeight: '1.6',
  margin: '0 0 16px',
}
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
const footer = {
  fontSize: '13px',
  color: 'hsl(220, 10%, 46%)',
  margin: '32px 0 8px',
}
const signature = {
  fontSize: '13px',
  color: 'hsl(220, 10%, 46%)',
  margin: '0',
}
