import nodemailer from 'nodemailer'
import { config } from '../config.js'

let transport: nodemailer.Transporter | null = null
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!config.smtp.url) return false
  transport ??= nodemailer.createTransport(config.smtp.url)
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, text })
    return true
  } catch {
    return false
  }
}
