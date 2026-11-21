FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3-pil tesseract-ocr tesseract-ocr-eng tesseract-ocr-ita tesseract-ocr-por tesseract-ocr-rus \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN node --input-type=module -e '\
    import { recognizeReceipt } from "./src/ocr.js"; \
    const lines = await recognizeReceipt({ id: "build-check", path: "test/fixtures/receipt-green-one.png" }); \
    if (!lines.some(({ text }) => text.includes("TOTAL USD 80.00"))) throw new Error("Receipt OCR build check failed");'

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
