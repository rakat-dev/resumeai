// Shared base resume storage — persists across Tailor and Jobs tabs
const KEY = "resumeai_base_resume";

const DEFAULT_RESUME = `Rahul Katamneni — Senior Full Stack Engineer
(937) 718-5586 | rahul.kat.1107@gmail.com | LinkedIn | GitHub | Portfolio

SUMMARY
Senior Full Stack Engineer with 5+ years of experience designing and building scalable, cloud-native enterprise applications across backend, frontend, and distributed systems. Strong expertise in system design, microservices architecture, and high-throughput processing using Java, Spring Boot, and AWS. Proven experience leading architecture decisions, building resilient event-driven systems, and optimizing performance for large-scale applications.

SKILLS
Frontend: React.js, Angular, TypeScript, JavaScript, React Hooks, State Management, Frontend Architecture, CSS3
Backend: Java 17, Spring Boot, Spring MVC, Spring Security, RESTful APIs, Microservices, Hibernate, Java Concurrency, OAuth2/JWT
Cloud & DevOps: AWS (EC2, ECS, EKS, S3, RDS, Lambda, API Gateway, IAM, VPC), Docker, Kubernetes, CI/CD, Jenkins
Messaging & Streaming: Apache Kafka, AWS SNS/SQS, Event-Driven Architecture
Databases: PostgreSQL, MySQL, Oracle, MongoDB, Redis
Testing & Quality: JUnit, Mockito, Selenium
Observability: Splunk, Dynatrace, Kibana, CloudWatch, Distributed Tracing
Tools & Methods: Agile (Scrum), Jira, Git

PROFESSIONAL EXPERIENCE

Artificial Inventions | Dallas, TX                                    March 2024 – July 2025
Sr. Software Full Stack Engineer | Project: JPMorgan Chase
• Led design and development of 12+ high-performance banking microservices, enabling scalable, low-latency transaction processing for enterprise financial systems.
• Built 25+ secure REST APIs using Spring Boot, JAX-RS, and Spring MVC, reducing integration latency by 30%.
• Led system design discussions and architecture decisions for distributed banking platforms.
• Established API design standards and governance practices including versioning, documentation, and security guidelines.
• Led frontend architecture decisions for high-traffic banking applications.
• Developed responsive SPAs using React.js, TypeScript, and CSS3, building 15+ reusable UI components.
• Built Python-based data processing and orchestration utilities supporting backend services.
• Integrated React.js frontend modules with Spring Boot REST APIs, improving response times by 25%.
• Containerized applications using Docker and deployed on Kubernetes (EKS), reducing deployment time by 40%.
• Implemented multi-threaded transaction processing using Java Concurrency APIs, increasing throughput by 30%.
• Integrated Kafka-based streaming pipelines for real-time transaction validation and fraud detection.
• Enhanced CI/CD pipeline reliability, improving deployment success rates by 25%.
Tech Stack: Java 17, Spring Boot, Microservices, React.js, Apache Kafka, Redis, PostgreSQL, Docker, Kubernetes

Amazon | Seattle, WA                                                  Sept 2022 – Feb 2024
Software Development Engineer
• Architected large-scale AWS-based platforms leveraging ECS/EKS, Lambda, API Gateway, and RDS with 99.9% uptime.
• Designed secure AWS infrastructure using IAM roles, VPC networking, and security groups.
• Built Python microservices and automation tools, reducing manual operational effort by 30%.
• Managed Kubernetes-based deployments on AWS EKS with auto-scaling and self-healing strategies.
• Delivered end-to-end full stack features using Angular and Spring Boot.
• Designed and implemented scalable CI/CD pipelines using Jenkins, Maven, and GitLab.
• Defined service reliability metrics and monitoring dashboards improving failure detection by 35%.
Tech Stack: Java, Spring Boot, Angular, Python, AWS (ECS, EKS, Lambda, API Gateway, S3, RDS), Kubernetes, CI/CD

Centene                                                               May 2020 – July 2022
Software Engineer
• Developed enterprise backend applications using Java, J2EE, and Spring Boot.
• Implemented microservice-based backend services, reducing deployment dependency issues by 25%.
• Built reusable UI functionality using JavaScript, HTML5, and CSS3.
• Built Docker container images and standardized deployment configurations.
• Developed unit tests using JUnit and automated UI testing using Selenium WebDriver.
• Worked extensively in Linux/Unix environments, optimizing application performance.
• Collaborated with cross-functional teams across development, QA, and DevOps.
Tech Stack: Java, Spring Boot, JavaScript, HTML5, CSS3, SQL, Docker, JUnit, Selenium

EDUCATION
Master of Science in Computer Engineering — Wright State University, Dayton, Ohio | July 2022
Master of Science in Management (In Progress) — Faulkner State University, Alabama
Bachelor of Technology in Electronics and Communication Engineering — NIT Jamshedpur, India | April 2020`;

export function getBaseResume(): string {
  if (typeof window === "undefined") return DEFAULT_RESUME;
  try {
    return localStorage.getItem(KEY) || DEFAULT_RESUME;
  } catch { return DEFAULT_RESUME; }
}

export function saveBaseResume(text: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, text); } catch {}
}

export { DEFAULT_RESUME };
