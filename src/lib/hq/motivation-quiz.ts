/**
 * Motivation dashboard — objection drill bank.
 *
 * Every question is sourced from src/content/sales-bible.md (the objection
 * bank, cold call structure, commitment engineering, pricing gravity).
 * Static config: the drills cost nothing to run, unlike the Guru.
 *
 * `right` indexes into `options`. `why` is shown after answering, straight
 * from the bible's doctrine, so wrong answers still teach the playbook.
 */

export type QuizQuestion = {
  prompt:  string;
  options: string[];
  right:   number;
  why:     string;
};

export const QUIZ_BANK: QuizQuestion[] = [
  {
    prompt: `"It's too expensive." What's your first move?`,
    options: [
      `Offer 10% off to keep the conversation alive`,
      `"Is that expensive against the budget, or expensive against what you think it'll deliver?"`,
      `List every feature they'd be getting for the price`,
    ],
    right: 1,
    why: `Clarify before anything else. Budget vs value are different objections with different fixes. Never drop the price — price drops read as confession.`,
  },
  {
    prompt: `"Patients want to speak to a real person." Best reframe?`,
    options: [
      `"AI is the future — patients will get used to it"`,
      `"Right now they're not getting a real person, they're getting voicemail. The AI isn't replacing your human conversations. It's replacing the silence."`,
      `"Our AI is so good most patients can't tell the difference"`,
    ],
    right: 1,
    why: `The enemy is the unanswered call, not the human. The team still has every conversation that should be human — with a full summary in front of them.`,
  },
  {
    prompt: `"It'll sound robotic." What wins this one?`,
    options: [
      `The demo — "Two minutes, listen to it answer a real enquiry for a clinic like yours"`,
      `Explaining the voice technology stack in detail`,
      `Promising a money-back guarantee if it sounds robotic`,
    ],
    right: 0,
    why: `The demo eats this objection alive. Never argue it verbally — Kenny thought exactly that until he heard it: "I was surprised by how natural it sounds."`,
  },
  {
    prompt: `"We already have voicemail." Your move?`,
    options: [
      `"Voicemail is outdated technology"`,
      `"What percentage of missed callers actually leave a message?"`,
      `"Our system includes voicemail too, plus much more"`,
    ],
    right: 1,
    why: `Their own answer does the work. Voicemail is where enquiries go to die, and they know it. Bonus: they've already tried to solve this — so they know it matters.`,
  },
  {
    prompt: `"I need to think about it." What do you say?`,
    options: [
      `"No worries, I'll follow up next month"`,
      `"What's holding you back? This is a limited offer"`,
      `"So you've got the right things to think about: is it mainly the price, the product, or how it'd work in the clinic?"`,
    ],
    right: 2,
    why: `Whatever they name IS the real objection — handle that one. Then lock the next step: "Take the week. 15 minutes Friday and you tell me where you've landed either way."`,
  },
  {
    prompt: `"We tried a bot and turned it off." How do you respond?`,
    options: [
      `"Good. Whatever you tried deserved to be turned off. Keyword bots fire canned replies. This holds an actual conversation. DM the demo yourself, right now."`,
      `Defend chatbot technology — it's improved a lot recently`,
      `Ask which vendor it was so you can explain how you're different`,
    ],
    right: 0,
    why: `Their scar tissue is your differentiation. Never defend bots. Bury them — then let the demo prove the difference in two minutes.`,
  },
  {
    prompt: `"Send me some pricing." Best response?`,
    options: [
      `Email the pricing PDF within the hour — speed wins`,
      `"Price without scope is meaningless. Give me 15 minutes to scope what you need, then the pricing will mean something."`,
      `"Pricing starts at $290 a month" and let them anchor on it`,
    ],
    right: 1,
    why: `No proposal without a calendar. Ever. Two companies can quote the same number and deliver completely different outcomes.`,
  },
  {
    prompt: `They can't meet your price floor. What happens?`,
    options: [
      `Shave the setup fee to get the deal over the line`,
      `"It sounds like we're not the right fit at this investment level, and that's completely fine." Disengage calmly.`,
      `Offer a free month to sweeten it`,
    ],
    right: 1,
    why: `The walkaway rule: no arguing, no justifying. They either re-engage at your number or they walk. Both are wins. The moment you violate your own floor you lose authority.`,
  },
  {
    prompt: `Opening 10 seconds of a cold call. Which is the bible's open?`,
    options: [
      `"Hi, how are you today? Do you have a moment to talk about your phone system?"`,
      `"You weren't expecting my call, so I'll be quick. Can I have 30 seconds, and if it's not relevant you can hang up on me?"`,
      `"I'm calling local clinics about an exciting AI opportunity"`,
    ],
    right: 1,
    why: `Permission-based, pattern-breaking, zero neediness. The first 10 seconds decide everything.`,
  },
  {
    prompt: `What's the goal of a cold call?`,
    options: [
      `Sell the product while you have them on the phone`,
      `Sell the next step — a 15-minute demo booked in the calendar before you hang up`,
      `Qualify their budget so you don't waste time later`,
    ],
    right: 1,
    why: `Never sell the product on a cold call. Sell the next step. Calendar before proposal. Always.`,
  },
  {
    prompt: `Locking the next step — which is the bible's way?`,
    options: [
      `"When works best for you?"`,
      `"Thursday 2pm or Friday 10am?"`,
      `"I'll send a calendar link, pick any slot"`,
    ],
    right: 1,
    why: `Always two options, both yours. Options create motion, open questions create delay. Book it while you're on the call — and if a partner signs off, the partner is in that meeting.`,
  },
  {
    prompt: `"I'll think about it and get back to you" is…`,
    options: [
      `A soft yes — give them space and follow up in a week`,
      `The death rattle — a call isn't finished until a specific next step is on the calendar with clear ownership`,
      `A sign to send more information by email`,
    ],
    right: 1,
    why: `Commitment engineering: no call ends without a locked next step or a clean exit. Nothing lives in limbo.`,
  },
  {
    prompt: `The objection pattern, in order?`,
    options: [
      `Clarify → isolate → reframe → confirm`,
      `Acknowledge → discount → close`,
      `Listen → agree → pivot → pressure`,
    ],
    right: 0,
    why: `Objections are uncertainty wearing words. Clarify what they mean. Isolate it ("if we solve that, do we move forward?"). Reframe with truth. Confirm it's resolved.`,
  },
  {
    prompt: `"We used an answering service. It just took messages." This is…`,
    options: [
      `A red flag — they churn through vendors`,
      `A gift — they've already paid to solve this problem once. Priority is proven.`,
      `A reason to pitch a cheaper package`,
    ],
    right: 1,
    why: `"A message pad with a phone number" vs a captured booking. They already proved they'll pay — now show them the difference between a sticky note and a booking in their PMS.`,
  },
  {
    prompt: `The speed stat for the DM lane?`,
    options: [
      `Replies within 1 minute convert ~391% better than replies after 30 minutes`,
      `Most DMs are answered within a day, which is fine`,
      `50% of DMs convert if you reply within the hour`,
    ],
    right: 0,
    why: `Speed is found money. Deploy one number per conversation, matched to the moment — a number lands harder than a paragraph.`,
  },
  {
    prompt: `The homepage maths, from memory?`,
    options: [
      `100 missed calls = $1,000 lost`,
      `50 unanswered enquiries a month at 30% conversion and $500 a visit = $7,500 in bookings, every month`,
      `Every missed call costs exactly $103`,
    ],
    right: 1,
    why: `Run THEIR numbers with them, out loud. The monthly fee usually pays for itself with the first one or two captured bookings.`,
  },
  {
    prompt: `Who does the "103 calls, 24 bookings" stat belong to?`,
    options: [
      `Kenny at Physio K`,
      `The anonymous dental client, during a 12-day Christmas shutdown`,
      `A medspa in Melbourne`,
    ],
    right: 1,
    why: `Hard guardrail: NEVER attribute those numbers to Kenny or any physio. Kenny proof = his quotes and experience only.`,
  },
  {
    prompt: `"What about privacy / AHPRA?" — the right energy is…`,
    options: [
      `Deflect: "our legal team handles all that"`,
      `Confidence: "it's a reason to use us — AHPRA-aware, no clinical advice, clean records, Australian data handling. Compare that to a missed call where nothing is recorded at all."`,
      `Minimise: "regulators haven't caught up with AI yet"`,
    ],
    right: 1,
    why: `Confidence here IS the answer. Fumbling this question loses health clients on the spot — compliance fluency is a trust wedge, lead with it.`,
  },
];
