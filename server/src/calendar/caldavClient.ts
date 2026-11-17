import {
  CALDAV_ROOT_HOST,
  CalendarFetchError,
  allowedCaldavUrl,
  createByteBudget,
  type ByteBudget,
  type DavFetch,
  type DavResponse,
} from './guardedFetch';
import { CALDAV_NS, DAV_NS, childOf, childrenOf, parseMultistatus, textOf, type MultistatusResponse } from './xml';

/**
 * Cliente CalDAV mínimo para o iCloud: 4 requisições de corpo fixo.
 * Toda URL vinda do servidor (principal, home, href) é resolvida e revalidada
 * pelo mesmo allowlist do guardedFetch antes de ser usada.
 */

export const CALDAV_ROOT = `https://${CALDAV_ROOT_HOST}/`;
export const DEFAULT_MAX_CALENDARS = 30;

export interface WeekRange {
  start: Date;
  end: Date;
}

/** Fonte da semana: textos iCalendar brutos (um VCALENDAR por objeto). */
export interface CalendarSource {
  fetchWeek(range: WeekRange): Promise<string[]>;
}

export interface DavCalendar {
  url: URL;
  name: string;
}

const PRINCIPAL_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const HOME_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
const LIST_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>';

/** 2026-11-16T03:00:00.000Z → 20261116T030000Z */
export function toCaldavUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function reportBody(range: WeekRange): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    '<d:prop><c:calendar-data/></d:prop>' +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
    `<c:time-range start="${toCaldavUtc(range.start)}" end="${toCaldavUtc(range.end)}"/>` +
    '</c:comp-filter></c:comp-filter></c:filter>' +
    '</c:calendar-query>'
  );
}

function expectMultistatus(response: DavResponse): MultistatusResponse[] {
  if (response.status !== 207) throw new CalendarFetchError('http', response.status);
  return parseMultistatus(response.text);
}

function resolveHref(href: string, base: URL): URL {
  const url = href ? allowedCaldavUrl(href, base) : null;
  if (!url) throw new CalendarFetchError('blocked-url');
  return url;
}

function firstHrefProp(responses: MultistatusResponse[], uri: string, local: string): string {
  for (const response of responses) {
    for (const prop of response.props) {
      const href = textOf(childOf(childOf(prop, uri, local), DAV_NS, 'href'));
      if (href) return href;
    }
  }
  return '';
}

export interface CaldavClientOptions {
  /** Nomes de calendário a incluir (vazio = todos). */
  calendarNames: readonly string[];
  maxCalendars?: number;
  /** Teto de bytes por semana (padrão do guardedFetch). */
  maxWeekBytes?: number;
}

export function createCaldavClient(davFetch: DavFetch, options: CaldavClientOptions): CalendarSource & {
  listCalendars(budget?: ByteBudget): Promise<DavCalendar[]>;
} {
  const wanted = new Set(options.calendarNames.map((name) => name.toLocaleLowerCase('pt-BR')));
  const maxCalendars = options.maxCalendars ?? DEFAULT_MAX_CALENDARS;
  let home: URL | undefined;

  async function propfind(url: URL | string, depth: '0' | '1', body: string, budget: ByteBudget) {
    const response = await davFetch(url, { method: 'PROPFIND', depth, body }, budget);
    return { responses: expectMultistatus(response), base: response.url };
  }

  async function discoverHome(budget: ByteBudget): Promise<URL> {
    if (home) return home;
    const root = await propfind(CALDAV_ROOT, '0', PRINCIPAL_BODY, budget);
    const principal = resolveHref(firstHrefProp(root.responses, DAV_NS, 'current-user-principal'), root.base);
    const principalInfo = await propfind(principal, '0', HOME_BODY, budget);
    home = resolveHref(firstHrefProp(principalInfo.responses, CALDAV_NS, 'calendar-home-set'), principalInfo.base);
    return home;
  }

  async function listCalendars(budget: ByteBudget = createByteBudget(options.maxWeekBytes)): Promise<DavCalendar[]> {
    const homeUrl = await discoverHome(budget);
    const listing = await propfind(homeUrl, '1', LIST_BODY, budget);
    const calendars: DavCalendar[] = [];
    for (const response of listing.responses) {
      const props = response.props;
      const isCalendar = props.some((prop) => childOf(childOf(prop, DAV_NS, 'resourcetype'), CALDAV_NS, 'calendar'));
      if (!isCalendar) continue;
      const componentSet = props.map((prop) => childOf(prop, CALDAV_NS, 'supported-calendar-component-set')).find(Boolean);
      const supportsEvents =
        !componentSet ||
        childrenOf(componentSet, CALDAV_NS, 'comp').some((comp) => comp.attributes.name?.toUpperCase() === 'VEVENT');
      if (!supportsEvents) continue;
      const name = props.map((prop) => textOf(childOf(prop, DAV_NS, 'displayname'))).find(Boolean) ?? '';
      if (wanted.size > 0 && !wanted.has(name.toLocaleLowerCase('pt-BR'))) continue;
      calendars.push({ url: resolveHref(response.href, listing.base), name });
      if (calendars.length >= maxCalendars) break;
    }
    return calendars;
  }

  return {
    listCalendars,

    async fetchWeek(range) {
      const budget = createByteBudget(options.maxWeekBytes);
      const calendars = await listCalendars(budget);
      const texts: string[] = [];
      for (const calendar of calendars) {
        const response = await davFetch(calendar.url, { method: 'REPORT', depth: '1', body: reportBody(range) }, budget);
        for (const item of expectMultistatus(response)) {
          for (const prop of item.props) {
            const data = childOf(prop, CALDAV_NS, 'calendar-data');
            if (data && data.text.trim()) texts.push(data.text);
          }
        }
      }
      return texts;
    },
  };
}
