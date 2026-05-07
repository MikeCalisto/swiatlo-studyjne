export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, phone } = req.body;
    if (!email || !phone) {
      return res.status(400).json({ error: 'Email i telefon są wymagane' });
    }

    const posId        = process.env.PAYU_POS_ID;
    const clientId     = process.env.PAYU_CLIENT_ID;
    const clientSecret = process.env.PAYU_CLIENT_SECRET;
    const isSandbox    = process.env.PAYU_SANDBOX === 'true';

    const baseUrl  = isSandbox ? 'https://secure.snd.payu.com' : 'https://secure.payu.com';
    const siteBase = process.env.NEXT_PUBLIC_SITE_URL || 'https://swiatlo-studyjne.vercel.app';

    // 1) OAuth — pobierz token dostępu
    const tokenRes = await fetch(`${baseUrl}/pl/standard/user/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!tokenRes.ok) {
      console.error('PayU OAuth error:', tokenRes.status, await tokenRes.text());
      return res.status(500).json({ error: 'Błąd autoryzacji u operatora płatności' });
    }

    const { access_token } = await tokenRes.json();

    // 2) Utwórz zamówienie
    const customerIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1';
    const extOrderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const orderPayload = {
      notifyUrl:     `${siteBase}/api/webhook-payu`,
      continueUrl:   `${siteBase}/pl/thank-you`,
      customerIp,
      merchantPosId: posId,
      description:   'ŚWIATŁO STUDYJNE — kurs online fotografii portretowej',
      currencyCode:  'PLN',
      totalAmount:   '7900', // 79.00 zł w groszach
      extOrderId,
      buyer: { email, phone, language: 'pl' },
      products: [
        {
          name:      'Kurs online fotografii portretowej ŚWIATŁO STUDYJNE',
          unitPrice: '7900',
          quantity:  '1',
        },
      ],
    };

    const orderRes = await fetch(`${baseUrl}/api/v2_1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${access_token}`,
      },
      body:     JSON.stringify(orderPayload),
      redirect: 'manual', // WAŻNE: PayU zwraca 302, nie podążaj za nim
    });

    const orderText = await orderRes.text();
    let orderData;
    try {
      orderData = JSON.parse(orderText);
    } catch {
      console.error('PayU createOrder non-JSON response:', orderText);
      return res.status(500).json({ error: 'Nieprawidłowa odpowiedź od operatora płatności' });
    }

    if (orderData.redirectUri) {
      return res.status(200).json({ redirectUrl: orderData.redirectUri });
    }

    console.error('PayU createOrder failed:', orderData);
    return res.status(500).json({
      error: `Błąd płatności: ${orderData?.status?.statusDesc || 'nieznany błąd'}`,
    });

  } catch (error) {
    console.error('PayU payment API error:', error);
    return res.status(500).json({ error: 'Wewnętrzny błąd serwera' });
  }
}
