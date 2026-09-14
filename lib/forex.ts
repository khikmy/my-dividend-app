export const COUNTRY_TO_CURRENCY: Record<string, string> = {
  "台湾 (TWD)": "TWD",
  "ユーロ圏 (EUR)": "EUR",
  "モロッコ (MAD)": "MAD",
  "タイ (THB)": "THB",
  "カナダ (CAD)": "CAD",
  "アメリカ (USD)": "USD",
  "香港 (HKD)": "HKD",
  "マレーシア (MYR)": "MYR",
  "マカオ (MOP)": "MOP",
  "カンボジア (KHR)": "KHR",
  "シンガポール (SGD)": "SGD",
  "ラオス (LAK)": "LAK",
  "フィリピン (PHP)": "PHP",
  "UAE (AED)": "AED",
  "トルコ (TRY)": "TRY",
  "インド (INR)": "INR",
  "ベトナム (VND)": "VND",
};

export const CURRENCY_TO_COUNTRY: Record<string, string> = Object.entries(
  COUNTRY_TO_CURRENCY
).reduce((acc, [country, cur]) => {
  acc[cur] = country;
  return acc;
}, {} as Record<string, string>);

export async function fetchJpyRate(currency: string): Promise<number | null> {
  if (currency === "JPY") return 1.0;
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`, {
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.rates?.JPY ?? null;
  } catch (err) {
    console.error(`Failed to fetch exchange rate for ${currency}:`, err);
    return null;
  }
}

