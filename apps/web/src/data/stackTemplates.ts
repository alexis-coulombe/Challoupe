export interface StackTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  compose: string;
}

export const STACK_TEMPLATES: StackTemplate[] = [
  {
    id: 'nginx-static',
    name: 'Nginx static site',
    description: 'Serve a static site from a bind-mounted folder.',
    category: 'Web',
    compose: `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./site:/usr/share/nginx/html:ro
    restart: unless-stopped
`,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'A standalone Postgres database with a persistent volume.',
    category: 'Database',
    compose: `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: changeme
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres-data:
`,
  },
  {
    id: 'redis',
    name: 'Redis',
    description: 'An in-memory cache/store with append-only persistence.',
    category: 'Database',
    compose: `services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
`,
  },
  {
    id: 'wordpress',
    name: 'WordPress + MySQL',
    description: 'A WordPress site backed by its own MySQL database.',
    category: 'Web',
    compose: `services:
  wordpress:
    image: wordpress:latest
    ports:
      - "8081:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: changeme
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wordpress-data:/var/www/html
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: mysql:8
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: changeme
      MYSQL_RANDOM_ROOT_PASSWORD: "1"
    volumes:
      - db-data:/var/lib/mysql
    restart: unless-stopped

volumes:
  wordpress-data:
  db-data:
`,
  },
  {
    id: 'vaultwarden',
    name: 'Vaultwarden',
    description: 'A lightweight self-hosted Bitwarden-compatible password manager.',
    category: 'Utilities',
    compose: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    ports:
      - "8082:80"
    environment:
      SIGNUPS_ALLOWED: "true"
    volumes:
      - vaultwarden-data:/data
    restart: unless-stopped

volumes:
  vaultwarden-data:
`,
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    description: 'A self-hosted uptime monitor with a status page.',
    category: 'Monitoring',
    compose: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    ports:
      - "3001:3001"
    volumes:
      - uptime-kuma-data:/app/data
    restart: unless-stopped

volumes:
  uptime-kuma-data:
`,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description:
      "Run local LLMs for Challoupe's AI Assistant. After it's up, point Settings → Ollama base URL at http://<this-host>:11434.",
    category: 'AI',
    compose: `services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    restart: unless-stopped

volumes:
  ollama-data:
`,
  },
  {
    id: 'adminer',
    name: 'Adminer',
    description: 'A single-file web UI for managing SQL databases.',
    category: 'Utilities',
    compose: `services:
  adminer:
    image: adminer:latest
    ports:
      - "8083:8080"
    restart: unless-stopped
`,
  },
];
