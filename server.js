import express from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Өтініш тым жиі жіберілді. Бір минуттан кейін қайталап көр." }
});

const STUDYSPOT_INSTRUCTIONS = `
Сен StudySpot сайтының AI көмекшісісің.
Пайдаланушыға сыпайы, түсінікті, қысқа әрі пайдалы жауап бер.
Пайдаланушы қазақша жазса — қазақша, орысша жазса — орысша жауап бер.
Басқа тілде сұраса, сол тілде жауап беруге тырыс.
Сен жалпы білім, оқу пәндері, математика, экономика және күнделікті сұрақтарға көмектесесің.

STUDYSPOT ЖОБАСЫ ТУРАЛЫ БІЛІМ:
- StudySpot — студенттерге оқу орындарын табуға және броньдауға арналған демонстрациялық веб-жоба.
- Жоба интерфейсінде Тұран университеті, Әл-Фараби атындағы ҚазҰУ, Satbayev University және Astana IT University таңдаулары бар.
- Тұран университетінің демонстрациялық орындары:
  1) Тұран Open Coworking Zone — бас корпус, 2-қабат.
  2) Тұран Орталық Кітапханасы — бас корпус, 3-қабат.
  3) Топтық Жобалар Аудиториясы №205 — А-корпус, 2-қабат.
  4) IT-Lab & Кибер-бөлме — Б-корпус, 4-қабат.
- Интерфейсте күн, басталу уақыты, ұзақтығы және орын таңдау мүмкіндігі бар.
- Броньдау демонстрациялық прототип ретінде жұмыс істейді. Бұл жоба нақты университет жүйесімен немесе ресми бронь базасымен расталған деп айтпа.
- Картадағы, бос орындардағы, статистикадағы және кітапхана туралы мәліметтер осы прототиптің үлгі деректері. Оларды университеттің ресми, үнемі жаңарып тұратын ақпараты деп көрсетпе.
- Пайдаланушы нақты ресми ереже, жұмыс уақыты, мекенжай, баға немесе қолжетімділік сұраса, дерек жобада жоқ болса, оны ойдан шығарма. Ресми дереккөзден тексеру керегін айт.
- Броньдау бойынша: университетті, күнді, уақытты, ұзақтықты және бос орынды таңдап, "Броньдауды растау және QR алу" батырмасын басу керегін түсіндір.
- QR кодтағы деректер прототипте URL параметрлері арқылы көрсетіледі; серверлік бронь тексеруі қосылмағанын қажет кезде түсіндір.
Қауіпсіздік және адалдық:
- Белгісіз ақпаратты ойдан шығарма; сенімді болмасаң, ашық айт.
- API кілті, пароль, жеке құпия деректерді сұрама.
- Өзіңді ресми университет қызметкері ретінде таныстырма.
`;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "StudySpot AI" });
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: "AI қызметі әлі бапталмаған. Серверде OPENAI_API_KEY құпия айнымалысын орнату қажет."
      });
    }

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Сұрақ бос болмауы керек." });
    }

    const safeMessages = messages.slice(-12).map((item) => {
      const role = item?.role === "assistant" ? "assistant" : "user";
      const content = typeof item?.content === "string" ? item.content.trim().slice(0, 2000) : "";
      return { role, content };
    }).filter((item) => item.content.length > 0);

    if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
      return res.status(400).json({ error: "Соңғы хабарлама пайдаланушы сұрағы болуы керек." });
    }

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        instructions: STUDYSPOT_INSTRUCTIONS,
        input: safeMessages,
        max_output_tokens: 900
      })
    });

    const result = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      console.error("OpenAI API error:", apiResponse.status, result?.error?.message || "Unknown error");
      return res.status(502).json({
        error: "AI қызметінде қате пайда болды. Сервер баптауларын немесе API қолжетімділігін тексер."
      });
    }

    const reply = (result.output || [])
      .flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text)
      .join("\n")
      .trim();

    if (!reply) {
      return res.status(502).json({ error: "AI жауап дайындай алмады. Қайталап көр." });
    }

    res.json({ reply });
  } catch (error) {
    console.error("Chat server error:", error);
    res.status(500).json({ error: "Серверде уақытша қате болды. Кейінірек қайталап көр." });
  }
});

app.listen(PORT, () => {
  console.log(`StudySpot AI сервері http://localhost:${PORT} мекенжайында іске қосылды.`);
});
