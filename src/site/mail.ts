/**
 * Telling the owner that a message arrived (ADR 0019): one email, sent through
 * the owner's own mail server. Nothing else is sent, and no outside service is
 * asked to do it.
 *
 * The server is given as an address, like a database:
 *
 *   THECMS_SMTP=smtps://user:password@mail.example.com:465   (TLS from the start)
 *   THECMS_SMTP=smtp://127.0.0.1:2525                          (plain, this machine only)
 *
 * A plain connection carries the password in the clear, so it is refused
 * anywhere but on this machine.
 */
import { isEmail } from '../core/form.ts';

export interface Mail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
/** An address one line long, with nothing a header could be split on: the forms check addresses the same way (ADR 0049). */
export { isEmail };

/** A header value on one line. */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();
/** A header in words any mail program reads: plain ASCII as it is, anything else as UTF-8. */
const encodeHeader = (value: string): string => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`);

/** The message as the mail server receives it: headers, then the text, with lines that start with a dot escaped. */
export function mailText(mail: Mail, now = new Date(), id: string = crypto.randomUUID()): string {
  const domain = mail.from.split('@')[1] ?? 'localhost';
  const headers = [
    `From: ${oneLine(mail.from)}`,
    `To: ${oneLine(mail.to)}`,
    ...(mail.replyTo && isEmail(mail.replyTo) ? [`Reply-To: ${oneLine(mail.replyTo)}`] : []),
    `Subject: ${encodeHeader(oneLine(mail.subject))}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = Buffer.from(mail.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`.replace(/\r\n\./g, '\r\n..');
}

/** A mailer for this address, or null when none is given. Throws on an address it will not use. */
export function smtpMailer(address: string | undefined): Mailer | null {
  if (!address) return null;
  const url = new URL(address);
  const tls = url.protocol === 'smtps:';
  if (!tls && url.protocol !== 'smtp:') throw new Error('the mail server is an smtps:// or smtp:// address');
  if (!tls && !LOCAL.includes(url.hostname)) throw new Error('a plain smtp:// mail server is only used on this machine; use smtps:// for any other');
  const port = Number(url.port) || (tls ? 465 : 25);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return (mail) => send({ host: url.hostname, port, tls, user, password }, mail);
}

async function send(server: { host: string; port: number; tls: boolean; user: string; password: string }, mail: Mail): Promise<void> {
  if (!isEmail(mail.from) || !isEmail(mail.to)) throw new Error('a mail needs a valid sender and recipient');
  let buffer = '';
  let waiting: ((line: string) => void) | null = null;
  let failed: ((error: Error) => void) | null = null;
  const replies: string[] = [];
  const socket = await Bun.connect({
    hostname: server.host,
    port: server.port,
    tls: server.tls,
    socket: {
      data(_, chunk) {
        buffer += new TextDecoder().decode(chunk);
        let at = buffer.indexOf('\r\n');
        while (at >= 0) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          // A reply of several lines ends with the line whose code is followed by a space.
          if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
            const done = waiting;
            waiting = null;
            if (done) done(line);
            else replies.push(line);
          }
          at = buffer.indexOf('\r\n');
        }
      },
      error(_, error) {
        failed?.(error);
      },
      close() {
        failed?.(new Error('the mail server closed the connection'));
      },
    },
  });
  const reply = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const ready = replies.shift();
      if (ready) return resolve(ready);
      const timer = setTimeout(() => reject(new Error('the mail server did not answer')), 15_000);
      waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      failed = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  const expect = async (code: string, what: string): Promise<void> => {
    const line = await reply();
    if (!line.startsWith(code)) throw new Error(`the mail server refused ${what}: ${line}`);
  };
  const say = (line: string): void => {
    socket.write(`${line}\r\n`);
  };
  try {
    await expect('220', 'the connection');
    say(`EHLO ${server.host}`);
    await expect('250', 'the greeting');
    if (server.user) {
      say(`AUTH PLAIN ${Buffer.from(`\0${server.user}\0${server.password}`, 'utf8').toString('base64')}`);
      await expect('235', 'the sign-in');
    }
    say(`MAIL FROM:<${mail.from}>`);
    await expect('250', 'the sender');
    say(`RCPT TO:<${mail.to}>`);
    await expect('25', 'the recipient');
    say('DATA');
    await expect('354', 'the message');
    say(`${mailText(mail)}\r\n.`);
    await expect('250', 'the message');
    say('QUIT');
  } finally {
    failed = null;
    socket.end();
  }
}
