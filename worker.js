// Worker backend for "میان ده سؤال"
// Bind a KV namespace to this Worker with the variable name: SESSIONS
// (use the namespace named "saval_sessions" that was already created for you)

const DECOY_POOL = [
  "اگه یک روز وقت آزاد کامل داشتی چیکار می‌کردی؟",
  "آخرین باری که واقعاً خندیدی کِی بود؟",
  "یک عادت خوب که این ماه شروع کردی چیه؟",
  "اگه بتونی یک مهارت جدید یاد بگیری، چی رو انتخاب می‌کنی؟",
  "غذای مورد علاقه‌ات چیه؟",
  "یک فیلم یا سریال که اخیراً دیدی و دوستش داشتی؟",
  "اگه یک روز به گذشته برمی‌گشتی، به خودت چی می‌گفتی؟",
  "یک جای جدید که دوست داری بری کجاست؟",
  "صبح‌ها بیشتر دوست داری چیکار کنی؟",
  "یک چیز کوچیک که امروز خوشحالت کرد؟",
  "موزیکی که این روزها زیاد گوش می‌دی؟",
  "اگه یک کتاب پیشنهاد بدی، کدومه؟",
  "یک هدف کوچیک که این هفته داری؟",
  "دوست داری آخر هفته چطور بگذرونیش؟",
  "یک چیزی که دوست داری بیشتر درباره‌اش یاد بگیری؟"
];

// CORS: change '*' to your real domain (e.g. "https://saval.danyalcode.ir")
// once everything works, to lock the API down to only your site.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function genId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) id += chars[bytes[i] % chars.length];
  return id;
}

function cleanId(id) {
  return String(id || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    let input;
    try {
      input = await request.json();
    } catch (e) {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    const action = input.action;

    // ---------- create ----------
    if (action === "create") {
      const realQuestions = input.questions;
      const password = String(input.password || "").trim();

      if (!Array.isArray(realQuestions) || realQuestions.length < 1 || realQuestions.length > 9) {
        return json({ ok: false, error: "invalid_count" });
      }
      for (const q of realQuestions) {
        if (typeof q !== "string" || q.trim() === "") {
          return json({ ok: false, error: "empty_question" });
        }
      }
      if (password === "") return json({ ok: false, error: "empty_password" });

      const needDecoys = 10 - realQuestions.length;
      const decoys = shuffle(DECOY_POOL).slice(0, needDecoys);

      const all = shuffle([
        ...realQuestions.map((t) => ({ text: t.trim(), real: true })),
        ...decoys.map((t) => ({ text: t, real: false })),
      ]);

      let id, exists;
      do {
        id = genId();
        exists = await env.SESSIONS.get(id);
      } while (exists);

      const session = {
        id,
        password,
        questions: all,
        answers: null,
        answered: false,
        createdAt: Date.now(),
      };

      await env.SESSIONS.put(id, JSON.stringify(session));
      return json({ ok: true, id });
    }

    // ---------- get (respondent opening the link) ----------
    if (action === "get") {
      const id = cleanId(input.id);
      const raw = await env.SESSIONS.get(id);
      if (!raw) return json({ ok: false, error: "not_found" });
      const session = JSON.parse(raw);

      const publicQuestions = session.questions.map((q) => ({ text: q.text }));
      return json({ ok: true, questions: publicQuestions, answered: !!session.answered });
    }

    // ---------- answer (respondent submitting) ----------
    if (action === "answer") {
      const id = cleanId(input.id);
      const raw = await env.SESSIONS.get(id);
      if (!raw) return json({ ok: false, error: "not_found" });
      const session = JSON.parse(raw);
      if (session.answered) return json({ ok: false, error: "already_answered" });

      const answers = input.answers;
      if (!Array.isArray(answers) || answers.length !== session.questions.length) {
        return json({ ok: false, error: "invalid_answers" });
      }
      for (const a of answers) {
        if (typeof a !== "string" || a.trim() === "") {
          return json({ ok: false, error: "empty_answer" });
        }
      }

      session.answers = answers.map(String);
      session.answered = true;
      await env.SESSIONS.put(id, JSON.stringify(session));
      return json({ ok: true });
    }

    // ---------- view (creator checking results with password) ----------
    if (action === "view") {
      const id = cleanId(input.id);
      const raw = await env.SESSIONS.get(id);
      if (!raw) return json({ ok: false, error: "not_found" });
      const session = JSON.parse(raw);

      const password = String(input.password || "");
      if (!timingSafeEqual(session.password, password)) {
        return json({ ok: false, error: "wrong_password" });
      }

      if (!session.answered) return json({ ok: true, answered: false, items: [] });

      const items = [];
      session.questions.forEach((q, i) => {
        if (q.real) items.push({ text: q.text, answer: session.answers[i] || "" });
      });
      return json({ ok: true, answered: true, items });
    }

    return json({ ok: false, error: "unknown_action" });
  },
};
