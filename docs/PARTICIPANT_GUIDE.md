# Help test online shops for dark patterns

*About 10 minutes. You can stop at any time.*

## What this is

Some shopping sites use tricks that push people into spending more: a countdown timer that restarts, an extra item
quietly added to your cart, a fee that only appears at the last step, a "No thanks" button made tiny. India's
consumer protection authority has banned 13 such tricks ("dark patterns").

DarkScan is a free student project that checks for them. You shop in a normal browser window, the way you usually
do, and DarkScan watches the pages go by. It **never clicks anything for you**.

## Before you say yes, here is what happens to your data

**What is saved:** screenshots and the text of the pages you visit, which popups appeared, what was in your cart, and
the prices shown.

**What is *not* saved:** anything you type into a box (passwords, addresses, search words, card numbers). Typed text
is hidden in the screenshots and is never written down. Email addresses, phone numbers and card numbers that appear
on a page are blanked out. If you list your own name or street (the program asks), those are blanked out too.

**What it cannot hide:** a name or address that the website itself shows on the page, if you did not list it. That is
why the program makes a **text-only copy** to send, with no screenshots, and why you should look it over first.

**Payment:** recording stops by itself the moment a payment page appears, and saves nothing from it.

**Who sees it:** only the person who asked you to take part. Your copy is stored under a code such as `P07`, not your
name, and it is never published. Results are only ever reported as totals ("12 sessions on 5 shops"), never as
"P07 saw this".

**Your choices:** you can stop at any point, skip any shop, and ask for your copy to be deleted later. You will not be
asked why.

## What to do and not do

- Use a shop you normally use, or just browse one. **Stop before you pay.** Please do not type card or bank details.
- A guest checkout or a test account is best. Avoid being logged in to anything sensitive.
- Don't record banking, health, or anything you would not want a stranger to read.

## How to do it

1. Install **Node.js** (the "LTS" version) from <https://nodejs.org/> if you don't have it.
2. Download the DarkScan folder you were given and open it.
3. **Windows:** double-click `start-recording.cmd`. **Mac or Linux:** run `./start-recording.sh` in a terminal.
   The first time, it installs a few things (a minute or two).
4. It asks three questions: the shop's web address, any words to hide (your name, phone number, street), and
   whether to make a copy to send. Answer `y` to the last one.
5. A browser window opens. Shop as you normally would, up to the point of paying.
6. When you are done, **wait a second**, then close the browser window.
7. Your report opens. Look through it. If you made a copy, you will find it in the `share` folder.
8. Zip the folder inside `share` and send it to the person who asked you.

If anything looks wrong or private in the report, **don't send it**. Tell the person who asked you, and delete the
folders `runs` and `share`.

## Questions

Ask the person who invited you. To withdraw after sending, message them with your code and they will delete your copy.
