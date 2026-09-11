import heroCutout from "../assets/profile-cutout.png";

/**
 * All portfolio content lives here. Components never hardcode professional info.
 *
 * HERO IMAGE — `src/assets/profile-cutout.png` is currently a PLACEHOLDER portrait.
 * Replace it with your own transparent head-and-shoulders cutout (PNG with alpha).
 * The particle system derives everything from the image at runtime; no other change
 * is needed. Alpha is the mask; brightness only shapes star size/glow. If the file has
 * no alpha channel, a plain light or dark background is keyed out automatically.
 */
/** Production site URL — used for canonical, sitemap, and Open Graph references. */
export const siteUrl = "https://ujwaldas-eight.vercel.app";

export const profile = {
  name: "Ujwal Das H S",
  initials: "UD",
  role: "Backend Software Engineer",
  tagline: "Building reliable backend systems.",
  stackLine: ["Java", "Spring Boot", "PostgreSQL", "Distributed Systems"],
  status: "Available for engineering opportunities",
  years: "4+",
  yearsLabel: "Years of backend engineering",
  location: "Thiruvananthapuram, Kerala, India",
  email: "ujwaldas007@gmail.com",
  github: "https://github.com/ujwaldas",
  linkedin: "https://www.linkedin.com/in/ujwal-das-44842b16a/",
  resume: "/resume.pdf",
  heroImage: heroCutout,
  seoTitle: "Ujwal Das H S | Backend Software Engineer",
  seoDescription:
    "Ujwal Das H S is a Backend Software Engineer specializing in Java, Spring Boot, PostgreSQL, distributed systems, and scalable backend applications.",
};

export const navLinks = [
  { label: "About", href: "#about" },
  { label: "Experience", href: "#experience" },
  { label: "Projects", href: "#projects" },
  { label: "Skills", href: "#skills" },
  { label: "Contact", href: "#contact" },
];

export const about = {
  heading: "Backend engineer who likes understanding how systems actually work.",
  paragraphs: [
    "Ujwal Das H S is a Backend Software Engineer with 4+ years of experience building reliable backend systems using Java, Spring Boot, PostgreSQL, distributed systems, and modern backend technologies.",
    "I build and maintain production backend systems with a focus on Java, Spring Boot, PostgreSQL, APIs, integrations, authentication, database design, and production reliability.",
    "I enjoy understanding how application code, databases, infrastructure, messaging and external services interact in real systems.",
  ],
  techNodes: ["Java", "Spring Boot", "PostgreSQL", "Redis", "AWS", "Docker", "REST APIs"],
};

export const highlights = [
  { value: "85%", label: "API response time improvement", sub: "~2s → ~300ms" },
  { value: "376", label: "PostgreSQL tables", sub: "Liquibase-managed baseline" },
  { value: "1,300+", label: "Liquibase changesets", sub: "Schema history modernized" },
  { value: "4+", label: "Years experience", sub: "Production backend systems" },
  { value: "3.2.1 → 3.5.16", label: "Spring Boot upgrade", sub: "Platform modernization" },
  { value: "3–5", label: "Developers led", sub: "Reviews · sprints · delivery" },
];

export interface ExperienceEntry {
  company: string;
  role: string;
  period: string;
  location: string;
  summary: string;
  stack: string[];
  groups: { title: string; items: string[] }[];
}

export const experience: ExperienceEntry[] = [
  {
    company: "Revyrie Global",
    role: "Software Engineer",
    period: "February 2026 – Present",
    location: "Thiruvananthapuram",
    summary:
      "Developed and maintained backend applications across food-delivery and programmatic advertising products.",
    stack: ["Java", "Spring Boot", "PostgreSQL", "Redis", "AWS", "REST APIs"],
    groups: [
      {
        title: "FamilyMeal — Order Edit ownership",
        items: [
          "Eligibility rules and time-based restrictions",
          "Edit limits and validation",
          "Operational notifications",
        ],
      },
      {
        title: "DXKulture — Ad-tech platform",
        items: ["Demand partners, deals and compliance", "Creatives, inventory and reporting"],
      },
      {
        title: "Performance",
        items: [
          "Optimized order and restaurant listing APIs by removing an unnecessary ORM/database join",
          "Response time ~2 seconds → ~300ms (~85% improvement)",
        ],
      },
      {
        title: "Authentication",
        items: [
          "Implemented Auth0 with SPA and M2M flows",
          "Token validation, session management and Redis-backed token revocation",
        ],
      },
      {
        title: "Database & platform",
        items: [
          "Modernized PostgreSQL/Liquibase schema management across 376 tables and 1,300+ changesets",
          "Upgraded Spring Boot 3.2.1 → 3.5.16",
        ],
      },
      {
        title: "Infrastructure & production",
        items: [
          "AWS SQS, AWS S3, Docker and CI/CD",
          "Investigated and resolved issues across application, database, infrastructure and external services",
        ],
      },
    ],
  },
  {
    company: "Smart HMS",
    role: "Systems Engineer",
    period: "June 2022 – February 2026",
    location: "Thiruvananthapuram",
    summary: "Built Java/Spring Boot backend services for HR and Payroll systems.",
    stack: ["Java", "Spring Boot", "MySQL", "MongoDB", "Docker", "AWS S3", "PHP/Symfony"],
    groups: [
      {
        title: "HR & Payroll backend",
        items: [
          "Employee lifecycle, payroll and leave workflows",
          "RBAC, validation, exception handling and REST APIs",
          "Modular microservice-style backend components",
        ],
      },
      {
        title: "Hospital Management Systems (PHP/Symfony)",
        items: ["Patient workflows, billing, HR, inventory and reporting"],
      },
      {
        title: "Leadership",
        items: [
          "Led a team of 3–5 developers",
          "Code reviews, sprint planning, development coordination and feature delivery",
        ],
      },
      {
        title: "Operations",
        items: ["Deployments and releases", "Git, Ansible and production troubleshooting"],
      },
    ],
  },
];

export interface Project {
  name: string;
  kind: string;
  description: string;
  stack: string[];
  highlight: string;
  flow?: string[];
  domains?: string[];
  points: string[];
  metric?: { before: string; after: string; label: string };
}

export const projects: Project[] = [
  {
    name: "FamilyMeal",
    kind: "Food Ordering & Delivery Platform",
    description:
      "Owned the Order Edit system end-to-end: eligibility evaluation, time-based restrictions, edit limits, validation and operational notifications.",
    stack: ["Java", "Spring Boot", "PostgreSQL", "Docker", "JMS", "Quartz", "Stripe", "REST APIs"],
    highlight: "Order Edit system",
    flow: ["Customer", "Order API", "Eligibility Evaluator", "PostgreSQL", "Notification"],
    points: [
      "Order and restaurant listing APIs optimized by removing an unnecessary ORM/database join",
      "Scheduled jobs with Quartz, async messaging with JMS",
    ],
    metric: { before: "2s", after: "300ms", label: "API response time" },
  },
  {
    name: "DXKulture",
    kind: "Programmatic Advertising & Ad-Tech Platform",
    description:
      "Backend work across the demand side of a programmatic advertising platform, with a focus on authentication, schema management and platform upgrades.",
    stack: ["Java", "Spring Boot", "PostgreSQL", "Redis", "AWS", "Docker", "Liquibase", "Auth0"],
    highlight: "Auth0 + Redis token revocation",
    domains: ["Demand Partners", "Deals", "Creatives", "Inventory", "Compliance", "Reporting"],
    points: [
      "Auth0 SPA and M2M flows with token validation and Redis token revocation",
      "Liquibase schema management across 376 PostgreSQL tables / 1,300+ changesets",
      "Spring Boot 3.2.1 → 3.5.16 upgrade",
    ],
  },
];

export const skillGraph = {
  center: "Backend Engineering",
  nodes: [
    "Java",
    "Spring Boot",
    "PostgreSQL",
    "Redis",
    "AWS",
    "Docker",
    "REST APIs",
    "Hibernate",
    "Spring Security",
    "SQS",
    "Liquibase",
    "Auth0",
  ],
  edges: [
    ["Java", "Spring Boot"],
    ["Spring Boot", "Spring Security"],
    ["Spring Boot", "Hibernate"],
    ["Spring Boot", "REST APIs"],
    ["Hibernate", "PostgreSQL"],
    ["PostgreSQL", "Liquibase"],
    ["Spring Security", "Auth0"],
    ["Auth0", "Redis"],
    ["AWS", "SQS"],
    ["AWS", "Docker"],
    ["SQS", "Spring Boot"],
    ["Docker", "PostgreSQL"],
    ["Redis", "REST APIs"],
  ] as [string, string][],
};

export const otherTech = [
  "Spring Security",
  "JPA/Hibernate",
  "Redis",
  "AWS S3",
  "AWS SQS",
  "Docker Compose",
  "Liquibase",
  "Flyway",
  "JMS",
  "Quartz",
  "OAuth 2.0",
  "RBAC",
  "Gradle",
  "Maven",
  "Git",
  "GitLab Runner",
  "Linux",
  "Ansible",
  "MySQL",
  "MongoDB",
  "Go",
  "PHP",
  "SQL",
];

export const focus = [
  { title: "Java & JVM", items: ["Concurrency", "Thread Pools", "CompletableFuture", "JVM Internals", "Garbage Collection"] },
  { title: "Spring Boot", items: ["Spring Internals", "Security", "Transactions", "Architecture"] },
  { title: "PostgreSQL", items: ["Query Planning", "Indexes", "Transactions", "Locking", "Performance"] },
  { title: "Distributed Systems", items: ["Caching", "Messaging", "Kafka", "Fault Tolerance", "Service Architecture"] },
  { title: "Cloud", items: ["Docker", "AWS", "CI/CD", "Observability", "Production Debugging"] },
];

export const education = {
  degree: "Bachelor of Technology",
  field: "Electrical and Electronics Engineering",
  school: "UKF College of Engineering and Technology",
  location: "Thiruvananthapuram",
  period: "August 2016 – August 2020",
};

export const languages = ["English", "Malayalam", "Tamil", "Hindi"];

/** Secondary photos — drop files into public/images/ with these names. Missing files are hidden automatically. */
export const photos = [
  { src: "/images/profile-side-1.jpg", alt: "Ujwal, side profile" },
  { src: "/images/profile-mirror.jpg", alt: "Ujwal, mirror portrait" },
  { src: "/images/profile-side-2.jpg", alt: "Ujwal, side profile" },
  { src: "/images/profile-front-2.jpg", alt: "Ujwal, portrait" },
];
