import { hashPassword } from "../src/services/auth.js";

const password = process.argv[2];

if (!password) {
  console.error('Uso: npm run hash-password -- "clave-segura"');
  process.exit(1);
}

console.log(hashPassword(password));
