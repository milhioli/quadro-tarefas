import sax from 'sax';

/**
 * Leitor mínimo dos XML multistatus do CalDAV (conteúdo de terceiro).
 * - sax em modo strict, com só as 5 entidades XML (entidade desconhecida = erro);
 * - DOCTYPE recusado (o CalDAV não usa DTD), o que corta XML bomb/entidades;
 * - limites de profundidade e de quantidade de elementos.
 */

export const DAV_NS = 'DAV:';
export const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav';

export const MAX_XML_DEPTH = 32;
export const MAX_XML_ELEMENTS = 100_000;

export interface XmlElement {
  uri: string;
  local: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

export function parseXml(xml: string): XmlElement {
  // `strictEntities` existe no sax 1.6, mas não nos tipos do @types/sax 1.2.
  const options = { xmlns: true, strictEntities: true } as sax.SAXOptions;
  const parser = sax.parser(true, options);
  const root: XmlElement = { uri: '', local: '#document', attributes: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let count = 0;

  parser.ondoctype = () => {
    throw new XmlError('DOCTYPE não é aceito');
  };
  parser.onerror = () => {
    throw new XmlError('XML inválido');
  };
  parser.onopentag = (tag) => {
    const qualified = tag as sax.QualifiedTag;
    if (stack.length > MAX_XML_DEPTH) throw new XmlError('XML aninhado demais');
    count += 1;
    if (count > MAX_XML_ELEMENTS) throw new XmlError('XML grande demais');
    const attributes: Record<string, string> = {};
    for (const attribute of Object.values(qualified.attributes)) {
      if (attribute.prefix === 'xmlns' || attribute.name === 'xmlns') continue;
      attributes[attribute.local] = attribute.value;
    }
    const element: XmlElement = {
      uri: qualified.uri,
      local: qualified.local,
      attributes,
      children: [],
      text: '',
    };
    (stack[stack.length - 1] as XmlElement).children.push(element);
    stack.push(element);
  };
  parser.onclosetag = () => {
    stack.pop();
  };
  const appendText = (text: string) => {
    const current = stack[stack.length - 1];
    if (current) current.text += text;
  };
  parser.ontext = appendText;
  parser.oncdata = appendText;

  parser.write(xml).close();
  const document = root.children[0];
  if (!document) throw new XmlError('XML vazio');
  return document;
}

export function childrenOf(element: XmlElement | undefined, uri: string, local: string): XmlElement[] {
  return element ? element.children.filter((child) => child.uri === uri && child.local === local) : [];
}

export function childOf(element: XmlElement | undefined, uri: string, local: string): XmlElement | undefined {
  return element?.children.find((child) => child.uri === uri && child.local === local);
}

export function textOf(element: XmlElement | undefined): string {
  return element ? element.text.trim() : '';
}

export interface MultistatusResponse {
  href: string;
  /** Elementos DAV:prop dos propstat com status 200. */
  props: XmlElement[];
}

/** Lê um DAV:multistatus. Lança XmlError se o documento não for um. */
export function parseMultistatus(xml: string): MultistatusResponse[] {
  const root = parseXml(xml);
  if (root.uri !== DAV_NS || root.local !== 'multistatus') throw new XmlError('Resposta não é multistatus');
  return childrenOf(root, DAV_NS, 'response').map((response) => ({
    href: textOf(childOf(response, DAV_NS, 'href')),
    props: childrenOf(response, DAV_NS, 'propstat')
      .filter((propstat) => / 200 /.test(` ${textOf(childOf(propstat, DAV_NS, 'status'))} `))
      .flatMap((propstat) => childrenOf(propstat, DAV_NS, 'prop')),
  }));
}
