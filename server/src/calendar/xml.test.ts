import { describe, expect, it } from 'vitest';
import {
  CALDAV_NS,
  DAV_NS,
  MAX_XML_DEPTH,
  XmlError,
  childOf,
  childrenOf,
  parseMultistatus,
  parseXml,
  textOf,
} from './xml';

const MULTISTATUS = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/000000000/calendars/home/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Pessoal &amp; Casa</d:displayname>
        <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop><d:getctag/></d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe('parseXml', () => {
  it('monta a árvore com namespaces, atributos e texto', () => {
    const root = parseXml(MULTISTATUS);
    expect([root.uri, root.local]).toEqual([DAV_NS, 'multistatus']);
    const prop = childOf(childOf(childOf(root, DAV_NS, 'response'), DAV_NS, 'propstat'), DAV_NS, 'prop');
    expect(textOf(childOf(prop, DAV_NS, 'displayname'))).toBe('Pessoal & Casa');
    const comp = childOf(childOf(prop, CALDAV_NS, 'supported-calendar-component-set'), CALDAV_NS, 'comp');
    expect(comp?.attributes).toEqual({ name: 'VEVENT' });
  });

  it('lê CDATA como texto', () => {
    const root = parseXml('<d:x xmlns:d="DAV:"><![CDATA[BEGIN:VCALENDAR <tag>]]></d:x>');
    expect(root.text).toBe('BEGIN:VCALENDAR <tag>');
  });

  it('recusa DOCTYPE (corta entidades e XML bomb)', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><d:x xmlns:d="DAV:">&lol2;</d:x>`;
    expect(() => parseXml(bomb)).toThrow(XmlError);
    expect(() => parseXml('<!DOCTYPE html><d:x xmlns:d="DAV:"/>')).toThrow('DOCTYPE');
  });

  it('entidade desconhecida (inclusive de HTML) é erro', () => {
    expect(() => parseXml('<d:x xmlns:d="DAV:">&nbsp;</d:x>')).toThrow(XmlError);
    expect(() => parseXml('<d:x xmlns:d="DAV:">&xxe;</d:x>')).toThrow(XmlError);
  });

  it('XML malformado ou vazio é erro', () => {
    expect(() => parseXml('<d:x xmlns:d="DAV:"><d:y></d:x>')).toThrow(XmlError);
    expect(() => parseXml('')).toThrow(XmlError);
    expect(() => parseXml('texto solto')).toThrow(XmlError);
  });

  it('limita a profundidade', () => {
    const deep = `${'<a>'.repeat(MAX_XML_DEPTH + 5)}${'</a>'.repeat(MAX_XML_DEPTH + 5)}`;
    expect(() => parseXml(deep)).toThrow('aninhado demais');
  });

  it('childrenOf filtra por namespace e nome', () => {
    const root = parseXml('<d:r xmlns:d="DAV:" xmlns:o="urn:outro"><d:href>a</d:href><o:href>b</o:href><d:href>c</d:href></d:r>');
    expect(childrenOf(root, DAV_NS, 'href').map(textOf)).toEqual(['a', 'c']);
  });
});

describe('parseMultistatus', () => {
  it('devolve href e só os props com status 200', () => {
    const [response] = parseMultistatus(MULTISTATUS);
    expect(response?.href).toBe('/000000000/calendars/home/');
    expect(response?.props).toHaveLength(1);
    expect(childOf(response?.props[0], DAV_NS, 'getctag')).toBeUndefined();
  });

  it('recusa documento que não é multistatus', () => {
    expect(() => parseMultistatus('<d:error xmlns:d="DAV:"/>')).toThrow('multistatus');
  });
});
