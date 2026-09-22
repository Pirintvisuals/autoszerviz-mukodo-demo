// Renders the link-preview card and writes public/og.jpg.
//
//   node tools/make-og.mjs          # starts a one-shot receiver on :8897
//
// Then open http://localhost:8896/_og.html (a copy of tools/make-og.html placed
// in public/) and the page POSTs its canvas here. Two processes rather than one
// because the drawing needs a real canvas, which only the browser has, and the
// writing needs a filesystem, which only Node has.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "public", "og.jpg");
const PORT = 8897;

const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method !== "POST") { res.writeHead(405); res.end("post only"); return; }

    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
        const m = body.match(/^data:image\/jpeg;base64,(.+)$/s);
        if (!m) { res.writeHead(400); res.end("not a jpeg data url"); return; }
        const buf = Buffer.from(m[1], "base64");
        fs.writeFileSync(OUT, buf);
        console.log(`og.jpg megírva: ${(buf.length / 1024).toFixed(0)} KB`);
        res.writeHead(200); res.end("ok");
        server.close();
    });
});

server.listen(PORT, () => console.log(`Várom a kártyát a :${PORT} porton...`));
