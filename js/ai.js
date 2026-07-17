// Claude Vision integration — runs directly from the browser using the
// user's own Anthropic API key (stored locally, never sent anywhere but
// api.anthropic.com).

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_DIMENSION = 1024;

export const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku (速い・安い)' },
  { value: 'claude-sonnet-5', label: 'Sonnet (バランス・推奨)' },
  { value: 'claude-opus-4-8', label: 'Opus (高精度・高コスト)' },
];

const PROMPT = `あなたは栄養士です。添付された食事の写真を見て、含まれる料理・食品を特定し、量を目視で推定した上で、栄養価を見積もってください。
複数の料理が写っている場合は合計値を計算してください。

必ず次のJSON形式のみで回答してください。説明文やマークダウンのコードフェンスは不要です。

{
  "foodName": "料理名を簡潔に(例: 鶏胸肉と白米、ブロッコリーのプレート)",
  "description": "推定した内容量の簡単な説明(1文)",
  "calories": 数値(kcal),
  "protein_g": 数値(g),
  "fat_g": 数値(g),
  "carbs_g": 数値(g),
  "confidence": "high" | "medium" | "low"
}`;

// Resize an image File/Blob down to MAX_DIMENSION on its longest side and
// return { base64 (no data: prefix), mediaType, dataUrl } as a JPEG.
export function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width >= height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(objectUrl);
      resolve({
        base64: dataUrl.split(',')[1],
        mediaType: 'image/jpeg',
        dataUrl,
      });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(objectUrl);
      reject(e);
    };
    img.src = objectUrl;
  });
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AIの応答からJSONを抽出できませんでした');
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function analyzeFoodPhoto({ apiKey, model, base64, mediaType }) {
  if (!apiKey) throw new Error('APIキーが設定されていません。設定画面で入力してください。');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    if (res.status === 401) throw new Error('APIキーが無効です。設定画面を確認してください。');
    throw new Error(`AI解析に失敗しました (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const text = data?.content?.find((c) => c.type === 'text')?.text ?? '';
  const parsed = extractJson(text);

  return {
    foodName: String(parsed.foodName ?? '不明な食事'),
    description: String(parsed.description ?? ''),
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein_g) || 0,
    fat: Number(parsed.fat_g) || 0,
    carbs: Number(parsed.carbs_g) || 0,
    confidence: parsed.confidence ?? 'medium',
  };
}
