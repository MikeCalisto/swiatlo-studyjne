import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody   = await getRawBody(req);
    const sigHeader = req.headers['openpayu-signature'] || '';
    const secondKey = process.env.PAYU_SECOND_KEY || '';

    // Parsuj nagłówek podpisu: sender=...;signature=HEX;algorithm=MD5
    const sigParts = Object.fromEntries(
      sigHeader.split(';').map(p => {
        const [k, v] = p.split('=');
        return [k?.trim(), v?.trim()];
      })
    );

    const receivedSig = sigParts['signature'];
    const algorithm   = (sigParts['algorithm'] || 'MD5').toUpperCase();

    if (!receivedSig || !secondKey) {
      console.error('PayU webhook: brak podpisu lub klucza');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Weryfikacja podpisu: MD5(rawBody + secondKey)
    const expectedSig = algorithm === 'SHA256'
      ? crypto.createHash('sha256').update(rawBody + secondKey).digest('hex')
      : crypto.createHash('md5').update(rawBody + secondKey).digest('hex');

    if (expectedSig.toLowerCase() !== receivedSig.toLowerCase()) {
      console.error('PayU webhook: błędny podpis');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(rawBody);
    const order   = payload?.order;

    console.log('PayU webhook otrzymano:', {
      orderId:    order?.orderId,
      extOrderId: order?.extOrderId,
      status:     order?.status,
      amount:     order?.totalAmount,
      email:      order?.buyer?.email,
    });

    if (order?.status === 'COMPLETED') {
      console.log('✅ Płatność zakończona sukcesem:', order.extOrderId, order.buyer?.email);
      // TODO: wyślij klientowi dostęp do kursu (np. przez Telegram bot lub e-mail)
    }

    // PayU wymaga odpowiedzi 200 OK
    return res.status(200).json({ status: 'OK' });

  } catch (error) {
    console.error('PayU webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
