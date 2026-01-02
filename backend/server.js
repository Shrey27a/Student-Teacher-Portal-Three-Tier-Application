const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");

const app = express();
app.use(cors());
app.use(express.json());

const REGION = "ap-south-1"; // change if needed
let db;

/* -------------------- AWS SSM CONFIG -------------------- */

const ssm = new SSMClient({ region: REGION });

async function getDBConfig() {
  const command = new GetParametersCommand({
    Names: [
      "/myapp/db/host",
      "/myapp/db/user",
      "/myapp/db/password",
      "/myapp/db/name"
    ],
    WithDecryption: true
  });

  const response = await ssm.send(command);

  const params = {};
  response.Parameters.forEach(p => {
    const key = p.Name.split("/").pop();
    params[key] = p.Value;
  });

  return {
    host: params.host,
    user: params.user,
    password: params.password,
    database: params.name
  };
}

/* -------------------- DB CONNECTION WITH RETRY -------------------- */

async function connectWithRetry(retries = 10, delay = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const dbConfig = await getDBConfig();

      const pool = mysql.createPool({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        connectionLimit: 10,
        ssl: { rejectUnauthorized: false }
      });

      console.log(`✅ Connected to RDS (Attempt ${i})`);
      return pool;

    } catch (err) {
      console.error(`❌ DB connection failed (Attempt ${i})`, err.message);
      if (i === retries) throw err;
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

/* -------------------- DB INIT -------------------- */

async function ensureTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS student (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255),
      roll_number VARCHAR(255),
      class VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS teacher (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255),
      subject VARCHAR(255),
      class VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Tables verified");
}

/* -------------------- API ROUTES -------------------- */

app.get("/", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM student");
    res.json({ message: "Backend is running 🚀", data: rows });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

app.get("/student", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM student");
  res.json(rows);
});

app.get("/teacher", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM teacher");
  res.json(rows);
});

app.post("/addstudent", async (req, res) => {
  const { name, rollNo, class: className } = req.body;

  await db.query(
    "INSERT INTO student (name, roll_number, class) VALUES (?, ?, ?)",
    [name, rollNo, className]
  );

  res.json({ message: "Student added" });
});

app.post("/addteacher", async (req, res) => {
  const { name, subject, class: className } = req.body;

  await db.query(
    "INSERT INTO teacher (name, subject, class) VALUES (?, ?, ?)",
    [name, subject, className]
  );

  res.json({ message: "Teacher added" });
});

app.delete("/student/:id", async (req, res) => {
  await db.query("DELETE FROM student WHERE id = ?", [req.params.id]);
  res.json({ message: "Student deleted" });
});

app.delete("/teacher/:id", async (req, res) => {
  await db.query("DELETE FROM teacher WHERE id = ?", [req.params.id]);
  res.json({ message: "Teacher deleted" });
});

/* -------------------- START SERVER -------------------- */

(async () => {
  try {
    db = await connectWithRetry();
    await ensureTables(db);

    const PORT = 3500;
    app.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  } catch (err) {
    console.error("❌ App failed to start:", err);
    process.exit(1);
  }
})();
