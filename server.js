const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const axiosRetry = require('axios-retry');

const app = express();
const db = new sqlite3.Database('links.db', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to database');
  initializeDatabase();
});

const bot = new TelegramBot('6135458704:AAEYR6k_6INLvYI_H0XkzI9a2or9turPsvw', {polling: true});

axiosRetry(axios, { retries: 3 });

function initializeDatabase() {
  db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS links (url TEXT)", (err) => {
      if (err) return console.error(err.message);
    });

    db.all("PRAGMA table_info(links);", [], (err, rows) => {
      if (err) return console.error(err.message);

      const hasAvailabilityColumn = rows.some(row => row.name === 'availability');
      if (!hasAvailabilityColumn) {
        db.run("ALTER TABLE links ADD COLUMN availability TEXT", (err) => {
          if (err) return console.error(err.message);
          console.log('Column availability added');
        });
      }
    });
  });
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

const chatId = -4004628234;

async function checkAvailability(url) {
    try {
const response = await axios.get(url, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
    }
});

        const $ = cheerio.load(response.data);
        const availabilityText = $('#product-buy-button').text().trim();
        const buyButtonClass = $('.buy-button__label.ng-star-inserted').length > 0;  // Проверка наличия класса
        const buyComfy = $('.base-button__text').text().trim();
        

        if (availabilityText.includes('Купить') || buyButtonClass || buyComfy.includes('Купити')) {
            return 'Товар в наличии';
        } else {
            return 'Нет в наличии';
        }
    } catch (error) {
        console.error(`Failed to check availability for ${url}:`, error.message);
        return 'Error';
    }
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendNotification(links) {
    const linksList = links.map(link => `${link.url} - ${link.availability}`).join('\n');
    await bot.sendMessage(chatId, linksList);
}

async function checkAllLinks() {
    db.all("SELECT rowid AS id, url, availability FROM links", async (err, links) => {
        if (err) return console.error(err);

        let updatedLinks = [];
        for (const link of links) {
            const availability = await checkAvailability(link.url);
            await sleep(1000);  // Задержка в 1 секунду между запросами
            if (availability !== link.availability) {
                db.run("UPDATE links SET availability = ? WHERE rowid = ?", [availability, link.id], error => {
                    if (error) console.error(error.message);
                });
                updatedLinks.push({ url: link.url, availability });
            }
        }

        if (updatedLinks.length > 0) {
            await sendNotification(updatedLinks);
        }
    });
}

setInterval(checkAllLinks, 60000);

app.get('/', (req, res) => {
    db.all("SELECT rowid AS id, url, availability FROM links", (err, links) => {
        if (err) return console.error(err);
        res.render('index', { links });
    });
});

app.post('/add-link', (req, res) => {
    const { url } = req.body;
    db.run("INSERT INTO links (url) VALUES (?)", url, (err) => {
        if (err) return console.error(err);
        res.redirect('/');
    });
});

app.post('/delete-link', (req, res) => {
    db.run("DELETE FROM links WHERE rowid = ?", req.body.id, (err) => {
        if (err) return console.error(err);
        res.redirect('/');
    });
});

bot.setMyCommands([
    {command: '/all', description: 'View the list of all links'},
    {command: '/active', description: 'View the list of available links'}
]);

bot.onText(/\/all/, (msg) => {
    const chatId = msg.chat.id;
    
    db.all("SELECT rowid AS id, url, availability FROM links", (err, links) => {
        if (err) {
            console.error(err);
            bot.sendMessage(chatId, 'An error occurred while fetching the links.');
            return;
        }

        if (links.length === 0) {
            bot.sendMessage(chatId, 'The list is empty.');
        } else {
            const linksList = links.map(link => `${link.id}. ${link.url} - ${link.availability}`).join('\n');
            bot.sendMessage(chatId, linksList);
        }
    });
});

bot.onText(/\/active/, (msg) => {
    const chatId = msg.chat.id;
    
    db.all("SELECT rowid AS id, url, availability FROM links WHERE availability = 'Товар в наличии'", (err, links) => {
        if (err) {
            console.error(err);
            bot.sendMessage(chatId, 'An error occurred while fetching the links.');
            return;
        }

        if (links.length === 0) {
            bot.sendMessage(chatId, 'No available links.');
        } else {
            const linksList = links.map(link => `${link.id}. ${link.url}`).join('\n');
            bot.sendMessage(chatId, linksList);
        }
    });
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
