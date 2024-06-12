import express from "express";
import puppeteer from "puppeteer-extra";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";
import { parse } from "url";
import axios from "axios"; // Import axios for uploading image
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import sharp from "sharp";

// Setup puppeteer with stealth and recaptcha plugins
puppeteer.use(StealthPlugin());
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: "2captcha",
      token: "16bea4284bb73a1fb1a707d2bf28fb2a", // Replace with your 2Captcha API key
    },
    visualFeedback: true, // Shows a colored box around solved captchas for debugging
  })
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const EXPECTED_API_KEY = "JZt8sjsVNMBxHZuhwAJJNi1Rzp9SyvPY"; // Load the expected API key from environment variables

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getUniqueFilename(url, hostname, randomInteger) {
  let filename = `${hostname}-${randomInteger}.jpg`;
  let counter = 1;
  while (
    await fs
      .access(path.join(__dirname, filename))
      .then(() => true)
      .catch(() => false)
  ) {
    filename = `${hostname}-${randomInteger}-${counter}.jpg`;
    counter++;
  }
  return filename;
}

// Middleware to check for API key
app.use((req, res, next) => {
  const apiKey = req.query.apiKey || req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(400).json({ error: "Missing API key" });
  }
  if (apiKey !== EXPECTED_API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }
  next();
});

// Define a route to capture a screenshot
app.get("/screenshot/:url(*)", async (req, res) => {
  const url = req.params.url;
  const { hostname } = parse(url);
  const randomInteger = getRandomInt(1, 9999);
  const currentDate = new Date().toLocaleDateString();
  const currentTime = new Date().toLocaleTimeString([], { hour12: true }); // Get current time in AM/PM format
  let filename;

  try {
    filename = await getUniqueFilename(url, hostname, randomInteger);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // Set the viewport to a specific size
    await page.setViewport({ width: 1600, height: 1600 });

    page.on("request", async (request) => {
      if (request.url().includes("cloudflare")) {
        console.log("Cloudflare challenge detected:", request.url());
      }
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Solve any reCAPTCHAs
    const { captchas, filtered } = await page.findRecaptchas();
    if (captchas.length > 0) {
      console.log("Solving CAPTCHAs...");
      const solved = await page.solveRecaptchas();
      console.log("CAPTCHAs solved:", solved);
    }

    // Function to mimic human behavior
    async function mimicHumanInteraction(page) {
      // Random scrolling
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, window.innerHeight / 2);
        });
        await page.waitForTimeout(getRandomInt(500, 1500));
      }

      // Random mouse movements
      await page.mouse.move(getRandomInt(0, 100), getRandomInt(0, 100));
      await page.mouse.move(getRandomInt(100, 200), getRandomInt(100, 200));
      await page.waitForTimeout(getRandomInt(500, 1500));

      // Random clicks
      await page.mouse.click(getRandomInt(50, 150), getRandomInt(50, 150));
      await page.waitForTimeout(getRandomInt(500, 1500));
    }

    // For reCAPTCHA v3, mimic human interaction
    if (filtered.some((captcha) => captcha._type === "v3")) {
      console.log("Handling reCAPTCHA v3...");
      await mimicHumanInteraction(page);
    }

    // Wait for the page to fully load and settle down
    await page.waitForTimeout(3000);

    // Capture screenshot (only the viewport, not full page)
    const screenshotBuffer = await page.screenshot({
      fullPage: false, // Set to false to capture only the viewport
    });

    await browser.close();

    // Add banner using sharp
    const textOverlay = Buffer.from(
      `<svg width="1600" height="50">
        <rect width="1600" height="50" style="fill:black"/>
        <text x="10" y="30" font-size="20" fill="white" font-family="Tahoma">
          Screenshot taken on ${currentDate} at ${currentTime} IST and used on theaifomo.com
        </text>
      </svg>`
    );

    const finalImage = await sharp(screenshotBuffer)
      .extend({
        top: 0,
        bottom: 50, // Extra height for the banner
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .composite([{ input: textOverlay, top: 1600, left: 0 }])
      .jpeg() // Convert to JPG
      .toBuffer();

    // Set response headers for downloading
    res.set({
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "image/jpeg",
    });

    // Send the image buffer as an attachment for download
    res.send(finalImage);
  } catch (error) {
    console.error("Error capturing screenshot:", error.message);

    // Log the error details
    await fs.appendFile(
      "error.log",
      `${new Date().toISOString()} - Error: ${error.message}\n`
    );

    // Handle error response
    if (error.message.includes("net::ERR")) {
      res
        .status(500)
        .json({ error: "Network error occurred while capturing screenshot." });
    } else if (error.message.includes("Timeout")) {
      res
        .status(500)
        .json({ error: "Timeout error occurred while capturing screenshot." });
    } else {
      res.status(500).json({ error: "Error capturing screenshot." });
    }
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

