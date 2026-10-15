/* ============================================================
   ATS Checker — SEO / Digital Marketing skills taxonomy
   Each canonical skill lists aliases that count as a match.
   ============================================================ */

const SKILL_CATEGORIES = {
  "Core SEO": [
    "seo","technical seo","on-page seo","off-page seo","local seo","international seo",
    "ecommerce seo","enterprise seo","seo audit","keyword research","link building",
    "backlink analysis","serp analysis","search intent","competitor analysis","site architecture",
    "internal linking","crawlability","indexation","log file analysis","structured data",
    "schema markup","canonicalization","robots.txt","xml sitemap","core web vitals","page speed",
    "mobile-first indexing","hreflang","rich snippets","featured snippets","e-e-a-t","topical authority",
    "content clusters","pillar pages","entity seo","semantic seo","organic growth"
  ],
  "AEO / GEO / AI Search": [
    "answer engine optimization","generative engine optimization","ai overviews","llm optimization",
    "ai search","ai visibility","voice search","zero-click search","llms.txt","passage optimization",
    "chatgpt search","perplexity"
  ],
  "Content": [
    "content strategy","content marketing","content writing","copywriting","blog writing",
    "editorial calendar","content optimization","content audit","content gap analysis","content planning",
    "content calendar","ux writing","content production","thought leadership"
  ],
  "Analytics & CRO": [
    "google analytics","web analytics","conversion rate optimization","a/b testing","data analysis",
    "reporting","dashboards","kpi tracking","roi analysis","attribution modeling","utm tracking",
    "bigquery","sql","data visualization","funnel analysis","cohort analysis"
  ],
  "Tools & Platforms": [
    "google search console","google tag manager","looker studio","semrush","ahrefs","moz",
    "screaming frog","surfer seo","clearscope","sistrix","majestic","serpstat","google keyword planner",
    "answerthepublic","ubersuggest","yoast","rank math","brightedge","conductor","botify","deepcrawl",
    "sitebulb","hotjar","microsoft clarity","tableau","power bi"
  ],
  "Paid & Other Channels": [
    "ppc","google ads","sem","paid search","display advertising","meta ads","facebook ads",
    "linkedin ads","social media marketing","email marketing","marketing automation","hubspot",
    "mailchimp","marketo","salesforce","demand generation","lead generation"
  ],
  "Web & CMS": [
    "wordpress","elementor","webflow","shopify","wix","html","css","javascript","php",
    "gutenberg","woocommerce","magento","drupal","cms","react","figma"
  ],
  "Process & Leadership": [
    "project management","stakeholder management","cross-functional collaboration","agile","scrum",
    "team management","mentoring","budget management","strategic planning","go-to-market","roadmap"
  ]
};

/* Aliases / synonyms — any of these in the resume counts as the canonical skill present. */
const SKILL_ALIASES = {
  "seo":["search engine optimization","search engine optimisation"],
  "search engine optimization":["seo","search engine optimisation"],
  "technical seo":["tech seo"],
  "google analytics":["ga4","google analytics 4","ga 4","universal analytics","google analytics certified"],
  "google search console":["gsc","search console","webmaster tools"],
  "google tag manager":["gtm","tag manager"],
  "conversion rate optimization":["cro","conversion optimization","conversion rate optimisation"],
  "sem":["search engine marketing"],
  "ppc":["pay per click","pay-per-click","paid media"],
  "answer engine optimization":["aeo"],
  "generative engine optimization":["geo","geo optimization"],
  "core web vitals":["cwv","web vitals","lcp","inp","cls"],
  "a/b testing":["ab testing","split testing","multivariate testing"],
  "looker studio":["data studio","google data studio"],
  "ai overviews":["sge","search generative experience","ai overview"],
  "cms":["content management system"],
  "roi analysis":["return on investment","roas"],
  "kpi tracking":["kpis","key performance indicators"],
  "bigquery":["big query"],
  "power bi":["powerbi"],
  "meta ads":["facebook ads","instagram ads","meta advertising"],
  "ai visibility":["brand visibility in ai","ai brand mentions"],
  "wordpress":["wp","word press"],
  "schema markup":["schema.org","json-ld","structured markup"],
  "xml sitemap":["sitemap.xml","sitemaps"]
};

/* Soft skills — recognized but weighted lower than hard skills. */
const SOFT_SKILLS = new Set([
  "communication","leadership","collaboration","teamwork","problem solving","analytical",
  "creativity","adaptability","time management","attention to detail","organization","interpersonal",
  "critical thinking","decision making","self-motivated","detail-oriented","proactive","strategic thinking",
  "stakeholder management","project management","mentoring","presentation","negotiation","cross-functional collaboration",
  "team management","multitasking","prioritization","ownership","initiative"
]);

/* Strong resume action verbs (for the formatting check + generated bullets). */
const ACTION_VERBS = [
  "Led","Managed","Developed","Implemented","Increased","Improved","Optimized","Drove","Grew","Launched",
  "Created","Built","Analyzed","Executed","Delivered","Reduced","Generated","Spearheaded","Established",
  "Designed","Coordinated","Achieved","Boosted","Streamlined","Scaled","Audited","Researched","Ranked",
  "Owned","Directed","Accelerated"
];

/* Stopwords for the generic (non-dictionary) keyword extractor. */
const STOPWORDS = new Set((
  "a an the and or but if then else for of to in on at by with from into over under as is are was were be been being "+
  "this that these those it its their our your his her they we you i he she them us me my mine ours yours "+
  "will would should could can may might must shall do does did done have has had having not no nor so than too very "+
  "about above after again against all am any because before below between both during each few more most other some such "+
  "only own same up out off down just also per via etc eg ie which who whom whose what when where why how "+
  "job role position candidate company team work working experience experiences year years month months "+
  "responsibility responsibilities requirement requirements qualification qualifications skill skills ability abilities "+
  "strong excellent good great proven solid demonstrated knowledge understanding familiarity proficiency proficient "+
  "including include includes included using use used uses ensure ensuring help helping support supporting "+
  "preferred plus bonus must required prior relevant related within across including able looking seeking join "+
  "day days week weeks new etc based across high level ability drive manage develop build create deliver "+
  // common JD verbs that aren't skills
  "conduct conducting conducts implement implementing implemented implements own owns owning owned seek seeks "+
  "lead leads leading led improve improving improved increase increasing increased grow growing drive driving "+
  "manage managing managed manages management execute executing deliver delivering ensure provide providing "+
  "report reporting owns oversee overseeing collaborate collaborating partner perform define defining identify "+
  // role / title / seniority words (not skills)
  "title titles job jobs senior junior mid head vp director directors specialist specialists analyst analysts "+
  "coordinator coordinators associate associates intern internship executive executives officer officers "+
  "consultant consultants manager managers lead principal staff"
).split(/\s+/));

/* Build flat lookup structures. */
const ALL_SKILLS = [];       // {name, category, isSoft}
const SKILL_INDEX = {};      // name -> {category,isSoft,aliases:[...]}
(function(){
  for (const [cat, list] of Object.entries(SKILL_CATEGORIES)){
    for (const s of list){
      const isSoft = SOFT_SKILLS.has(s);
      ALL_SKILLS.push({name:s, category:cat, isSoft});
      SKILL_INDEX[s] = {category:cat, isSoft, aliases: SKILL_ALIASES[s] || []};
    }
  }
  // include soft skills not already in categories
  for (const s of SOFT_SKILLS){
    if (!SKILL_INDEX[s]){
      ALL_SKILLS.push({name:s, category:"Process & Leadership", isSoft:true});
      SKILL_INDEX[s] = {category:"Process & Leadership", isSoft:true, aliases: SKILL_ALIASES[s]||[]};
    }
  }
})();
