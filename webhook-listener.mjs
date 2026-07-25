import { createServer } from "node:http";

const server = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => (body += chunk));
	req.on("end", () => {
		console.log("\n--- webhook received ---");
		try {
			console.log(JSON.stringify(JSON.parse(body), null, 2));
		} catch {
			console.log(body);
		}
		res.writeHead(200).end("ok");
	});
});

server.listen(4000, () => console.log("webhook listener on :4000"));
