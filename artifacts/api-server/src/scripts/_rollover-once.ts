import { runDailySubscriptionRollover } from "../lib/subscription";
runDailySubscriptionRollover().then((r) => { console.log("rollover:", JSON.stringify(r)); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
