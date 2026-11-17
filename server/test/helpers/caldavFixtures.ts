/**
 * Fixtures do CalDAV/iCalendar ESCRITAS À MÃO a partir da RFC 4791/5545.
 * Nunca capture respostas da conta real: elas levariam DSID, host de
 * partição, nomes de calendário, títulos e e-mails para o repositório.
 * Placeholders: DSID 000000000, host p00-caldav.icloud.com, @example.com.
 */

export const PARTITION = 'https://p00-caldav.icloud.com';

export const PRINCIPAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>/</href>
    <propstat>
      <prop><current-user-principal><href>/000000000/principal/</href></current-user-principal></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

export const HOME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/000000000/principal/</href>
    <propstat>
      <prop><C:calendar-home-set><href>${PARTITION}:443/000000000/calendars/</href></C:calendar-home-set></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

export const LIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/000000000/calendars/</href>
    <propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat>
  </response>
  <response>
    <href>/000000000/calendars/pessoal/</href>
    <propstat>
      <prop>
        <resourcetype><collection/><C:calendar/></resourcetype>
        <displayname>Pessoal</displayname>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>${PARTITION}/000000000/calendars/trabalho/</href>
    <propstat>
      <prop>
        <resourcetype><collection/><C:calendar/></resourcetype>
        <displayname>Trabalho</displayname>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/000000000/calendars/lembretes/</href>
    <propstat>
      <prop>
        <resourcetype><collection/><C:calendar/></resourcetype>
        <displayname>Lembretes</displayname>
        <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

/** Resposta de REPORT com um objeto por evento (calendar-data escapado ou em CDATA). */
export function reportXml(icsTexts: string[]): string {
  const responses = icsTexts
    .map(
      (ics, index) => `
  <response>
    <href>/000000000/calendars/pessoal/evento-${index}.ics</href>
    <propstat>
      <prop><C:calendar-data><![CDATA[${ics}]]></C:calendar-data></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${responses}
</multistatus>`;
}

const SAO_PAULO_TZ = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Sao_Paulo',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:-0300',
  'TZOFFSETTO:-0300',
  'TZNAME:-03',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Monta um VCALENDAR com os VEVENTs dados (linhas sem CRLF). */
export function vcalendar(events: string[][], options: { timezones?: string[][] } = {}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//quadro-tarefas//fixture//PT',
    ...(options.timezones ?? [SAO_PAULO_TZ]).flat(),
    ...events.flatMap((event) => ['BEGIN:VEVENT', ...event, 'END:VEVENT']),
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export const SAO_PAULO_VTIMEZONE = SAO_PAULO_TZ;

/** VTIMEZONE "malicioso": mesmo TZID, offset absurdo. */
export const BOGUS_SAO_PAULO_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Sao_Paulo',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+1100',
  'TZOFFSETTO:+1100',
  'TZNAME:X',
  'END:STANDARD',
  'END:VTIMEZONE',
];
