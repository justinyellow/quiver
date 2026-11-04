import crypto from 'node:crypto'
import type { ScopeSet, Variable } from './types.js'

const FIRST = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy', 'Mallory', 'Niaj', 'Olivia', 'Peggy', 'Rupert', 'Sybil', 'Trent', 'Victor', 'Walter', 'Zoe']
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Lopez', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin', 'Lee', 'Clark']
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango']
const CITIES = ['London', 'Cape Town', 'Berlin', 'Tokyo', 'Lima', 'Toronto', 'Sydney', 'Nairobi', 'Oslo', 'Austin']
const COUNTRIES = ['South Africa', 'Germany', 'Japan', 'Canada', 'Brazil', 'Kenya', 'Norway', 'India', 'Australia', 'Chile']
const COLORS = ['red', 'green', 'blue', 'orange', 'purple', 'teal', 'magenta', 'cyan', 'lime', 'navy']
const pick = (a: string[]) => a[crypto.randomInt(a.length)]
const int = (min: number, max: number) => crypto.randomInt(min, max + 1)

export function dynamicVar(name: string): string | undefined {
  switch (name) {
    case '$guid': case '$randomUUID': return crypto.randomUUID()
    case '$timestamp': return String(Math.floor(Date.now() / 1000))
    case '$isoTimestamp': return new Date().toISOString()
    case '$randomInt': return String(int(0, 1000))
    case '$randomBoolean': return String(int(0, 1) === 1)
    case '$randomAlphaNumeric': return pick('abcdefghijklmnopqrstuvwxyz0123456789'.split(''))
    case '$randomFirstName': return pick(FIRST)
    case '$randomLastName': return pick(LAST)
    case '$randomFullName': return `${pick(FIRST)} ${pick(LAST)}`
    case '$randomNamePrefix': return pick(['Mr.', 'Ms.', 'Dr.', 'Mrs.'])
    case '$randomUserName': return `${pick(FIRST)}${int(1, 999)}`.toLowerCase()
    case '$randomEmail': return `${pick(FIRST)}.${pick(LAST)}${int(1, 99)}@example.com`.toLowerCase()
    case '$randomExampleEmail': return `${pick(FIRST)}@example.com`.toLowerCase()
    case '$randomPhoneNumber': return `${int(100, 999)}-${int(100, 999)}-${int(1000, 9999)}`
    case '$randomCity': return pick(CITIES)
    case '$randomCountry': return pick(COUNTRIES)
    case '$randomCountryCode': return pick(['ZA', 'DE', 'JP', 'CA', 'BR', 'KE', 'NO', 'IN', 'AU', 'CL'])
    case '$randomStreetAddress': return `${int(1, 9999)} ${pick(LAST)} Street`
    case '$randomLatitude': return (Math.random() * 180 - 90).toFixed(4)
    case '$randomLongitude': return (Math.random() * 360 - 180).toFixed(4)
    case '$randomColor': return pick(COLORS)
    case '$randomHexColor': return '#' + crypto.randomBytes(3).toString('hex')
    case '$randomWord': return pick(WORDS)
    case '$randomWords': return Array.from({ length: int(2, 5) }, () => pick(WORDS)).join(' ')
    case '$randomAdjective': return pick(['quick', 'lazy', 'bright', 'calm', 'eager', 'fancy', 'giant', 'happy'])
    case '$randomNoun': return pick(['car', 'tree', 'river', 'cloud', 'stone', 'bird', 'book', 'lamp'])
    case '$randomVerb': return pick(['run', 'jump', 'swim', 'read', 'write', 'build', 'test', 'ship'])
    case '$randomLoremWord': return pick(['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'])
    case '$randomLoremWords': return 'lorem ipsum dolor sit amet'
    case '$randomLoremSentence': return 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
    case '$randomLoremParagraph': return 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
    case '$randomIP': return `${int(1, 254)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`
    case '$randomIPV6': return Array.from({ length: 8 }, () => crypto.randomBytes(2).toString('hex')).join(':')
    case '$randomMACAddress': return Array.from({ length: 6 }, () => crypto.randomBytes(1).toString('hex')).join(':')
    case '$randomPassword': return crypto.randomBytes(12).toString('base64url')
    case '$randomUrl': return `https://${pick(WORDS)}.example.com`
    case '$randomDomainName': return `${pick(WORDS)}.example.com`
    case '$randomUserAgent': return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    case '$randomPrice': return (Math.random() * 1000).toFixed(2)
    case '$randomCurrencyCode': return pick(['USD', 'EUR', 'GBP', 'ZAR', 'JPY'])
    case '$randomProductName': return `${pick(['Ergonomic', 'Rustic', 'Sleek', 'Handmade'])} ${pick(['Chair', 'Table', 'Keyboard', 'Bottle'])}`
    case '$randomCompanyName': return `${pick(LAST)} ${pick(['Inc', 'LLC', 'Group', 'and Sons'])}`
    case '$randomJobTitle': return `${pick(['Senior', 'Lead', 'Principal', 'Junior'])} ${pick(['Engineer', 'Designer', 'Analyst', 'Manager'])}`
    case '$randomDateRecent': return new Date(Date.now() - int(0, 7 * 86400000)).toISOString()
    case '$randomDatePast': return new Date(Date.now() - int(0, 365 * 86400000)).toISOString()
    case '$randomDateFuture': return new Date(Date.now() + int(0, 365 * 86400000)).toISOString()
    case '$randomWeekday': return pick(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    case '$randomMonth': return pick(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])
    case '$randomBankAccount': return String(int(10000000, 99999999))
    case '$randomCreditCardMask': return String(int(1000, 9999))
    case '$randomFileName': return `${pick(WORDS)}.${pick(['txt', 'json', 'png', 'pdf'])}`
    case '$randomImageUrl': return 'https://picsum.photos/640/480'
    case '$randomAbstractImage': return 'https://picsum.photos/640/480'
    default: return undefined
  }
}

export function lookupVar(name: string, scopes: ScopeSet): string | undefined {
  if (name.startsWith('$')) return dynamicVar(name)
  if (name in scopes.local) return scopes.local[name]
  if (scopes.data && name in scopes.data) return stringify(scopes.data[name])
  if (name in scopes.environment) return scopes.environment[name]
  if (name in scopes.collection) return scopes.collection[name]
  if (name in scopes.globals) return scopes.globals[name]
  return undefined
}

function stringify(v: any): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

const VAR_RE = /\{\{\s*([^{}\s]+)\s*\}\}/g

export function interpolate(input: string, scopes: ScopeSet, depth = 0): string {
  if (!input || !input.includes('{{')) return input
  return input.replace(VAR_RE, (m, name) => {
    const v = lookupVar(name, scopes)
    if (v === undefined) return m
    return depth < 5 ? interpolate(v, scopes, depth + 1) : v
  })
}

export function unresolvedVars(input: string, scopes: ScopeSet): string[] {
  const out: string[] = []
  for (const m of input.matchAll(VAR_RE)) {
    if (lookupVar(m[1], scopes) === undefined) out.push(m[1])
  }
  return out
}

export function varsToMap(vars: Variable[] | undefined, decrypt?: (v: string) => string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of vars ?? []) {
    if (v.enabled === false || !v.key) continue
    out[v.key] = decrypt ? decrypt(v.value ?? '') : (v.value ?? '')
  }
  return out
}

export function emptyScopes(): ScopeSet {
  return { globals: {}, collection: {}, environment: {}, local: {}, data: {} }
}
