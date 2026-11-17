const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const app = express();
const PORT = Number(process.env.PORT || 3000);

// ============================================
// DATABASE CONNECTION - Aiven MySQL
// ============================================
const pool = mysql.createPool({
  host: process.env.DB_HOST || "visiontec-visiontec.i.aivencloud.com",
  port: Number(process.env.DB_PORT || 28128),
  user: process.env.DB_USER || "avnadmin",
  password: process.env.DB_PASSWORD || "AVNS_sNCBqJScG-zcAAmY3xT",
  database: process.env.DB_NAME || "defaultdb",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDb() {
  const ddl = [
`CREATE TABLE IF NOT EXISTS products(id VARCHAR(80) PRIMARY KEY,name VARCHAR(255),category VARCHAR(120),price DECIMAL(12,2) DEFAULT 0,stock INT DEFAULT 0,data_json JSON NOT NULL,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS customers(id VARCHAR(80) PRIMARY KEY,name VARCHAR(255),phone VARCHAR(50),email VARCHAR(255),data_json JSON NOT NULL,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS suppliers(id VARCHAR(80) PRIMARY KEY,name VARCHAR(255),contact VARCHAR(100),data_json JSON NOT NULL,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS sales(id VARCHAR(80) PRIMARY KEY,sale_date VARCHAR(30),customer VARCHAR(255),worker VARCHAR(255),payment_method VARCHAR(80),total DECIMAL(12,2) DEFAULT 0,data_json JSON NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS sale_items(id BIGINT AUTO_INCREMENT PRIMARY KEY,sale_id VARCHAR(80) NOT NULL,product_id VARCHAR(80),product_name VARCHAR(255),quantity INT DEFAULT 0,unit_price DECIMAL(12,2) DEFAULT 0,FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS expenses(id VARCHAR(80) PRIMARY KEY,title VARCHAR(255),amount DECIMAL(12,2) DEFAULT 0,expense_date VARCHAR(30),data_json JSON NOT NULL,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS team_members(id VARCHAR(80) PRIMARY KEY,name VARCHAR(255) UNIQUE,role VARCHAR(120),is_admin TINYINT(1) DEFAULT 0,password_hash VARCHAR(255),password_changed_by INT DEFAULT NULL,password_changed_at DATETIME DEFAULT NULL,data_json JSON NOT NULL,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,icon VARCHAR(40) DEFAULT NULL,color VARCHAR(20) DEFAULT NULL,active TINYINT(1) DEFAULT 1) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS users(id VARCHAR(80) PRIMARY KEY,username VARCHAR(255) UNIQUE,role VARCHAR(120),password_hash VARCHAR(255),is_active TINYINT(1) DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS settings(setting_key VARCHAR(120) PRIMARY KEY,setting_value JSON NOT NULL,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`,
`CREATE TABLE IF NOT EXISTS audit_logs(id BIGINT AUTO_INCREMENT PRIMARY KEY,actor VARCHAR(255),action VARCHAR(80),table_name VARCHAR(80),record_id VARCHAR(80),details TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`
  ];
  
  for (const sql of ddl) {
    try {
      await pool.query(sql);
    } catch (e) {
      console.log("Table creation skipped (may already exist):", e.message);
    }
  }
  
  const [rows] = await pool.query('SELECT COUNT(*) as count FROM users');
  if (rows[0].count === 0) {
    console.log('🔐 NO USERS FOUND - Creating default admin user...');
    console.log('Default login: Cornelius / admin123');
    
    // Create default admin user
    const hashedPassword = await bcrypt.hash('admin123', 12);
    await pool.execute(
      'INSERT INTO users (id, username, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?)',
      ['admin-001', 'Cornelius', 'admin', hashedPassword, 1]
    );
    
    // Create Jacob user
    const jacobPassword = await bcrypt.hash('jacob123', 12);
    await pool.execute(
      'INSERT INTO users (id, username, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?)',
      ['002', 'Jacob', 'Programmer', jacobPassword, 1]
    );
    
    console.log('✅ Default users created successfully!');
  }
}

const tables = ["products","customers","suppliers","sales","expenses","team_members"];
const stringify = x => JSON.stringify(x ?? {});

async function readTable(t) {
  const [rows] = await pool.query(`SELECT data_json FROM \`${t}\` ORDER BY 1`);
  return rows.map(r => typeof r.data_json === "string" ? JSON.parse(r.data_json) : r.data_json);
}

async function writeTable(conn,t,items) {
  if (!Array.isArray(items)) throw new Error(`Expected array for ${t}`);

  // Remember existing product images so a sync from another page can't wipe them
  let existingImages = new Map();
  if (t === "products") {
    const [old] = await conn.query("SELECT id, data_json FROM products");
    for (const r of old) {
      const d = typeof r.data_json === "string" ? JSON.parse(r.data_json) : r.data_json;
      if (d && d.image) existingImages.set(String(r.id), d.image);
    }
  }

  if (t === "sales") await conn.query("DELETE FROM sale_items");
  await conn.query(`DELETE FROM \`${t}\``);
  for (const x of items) {
    const id=String(x.id ?? `${Date.now()}-${Math.random()}`);
    if (t === "products" && !x.image && existingImages.has(id)) x.image = existingImages.get(id);
    const j=stringify(x);
    if(t==="products") await conn.execute("INSERT INTO products(id,name,category,price,stock,data_json) VALUES(?,?,?,?,?,?)",[id,x.name??"",x.category??"",Number(x.price)||0,Number(x.stock)||0,j]);
    if(t==="customers") await conn.execute("INSERT INTO customers(id,name,phone,email,data_json) VALUES(?,?,?,?,?)",[id,x.name??"",x.phone??"",x.email??"",j]);
    if(t==="suppliers") await conn.execute("INSERT INTO suppliers(id,name,contact,data_json) VALUES(?,?,?,?)",[id,x.name??"",x.contact??"",j]);
    if(t==="expenses") await conn.execute("INSERT INTO expenses(id,title,amount,expense_date,data_json) VALUES(?,?,?,?,?)",[id,x.title??"",Number(x.amount)||0,x.date??"",j]);
    if(t==="team_members") {
      await conn.execute("INSERT INTO team_members(id,name,role,is_admin,data_json) VALUES(?,?,?,?,?)",[id,x.name??"",x.role??"",x.isAdmin?1:0,j]);
    }
    if(t==="sales") {
      await conn.execute("INSERT INTO sales(id,sale_date,customer,worker,payment_method,total,data_json) VALUES(?,?,?,?,?,?,?)",[id,x.date??"",x.customer??"",x.worker??"",x.paymentMethod??"",Number(x.total)||0,j]);
      for(const line of (Array.isArray(x.items)?x.items:[]))
        await conn.execute("INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price) VALUES(?,?,?,?,?)",[id,String(line.id??""),line.name??"",Number(line.qty)||0,Number(line.price)||0]);
    }
  }
}

app.use(express.json({limit:"50mb"}));
app.use((req,res,next)=>/^\/(\.|server\.js|package|node_modules|backend)/i.test(req.path)?res.status(404).end():next());
app.use("/shared", express.static(__dirname));

app.get('/', (req, res) => {
  res.redirect('/home.html');
});

app.use(express.static(path.join(__dirname, '..')));

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

    if (rows.length === 0) {
      await pool.execute(
        'INSERT INTO audit_logs (actor, action, details) VALUES (?, ?, ?)',
        [username, 'LOGIN_FAILED', 'User not found']
      );
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const user = rows[0];

    if (user.is_active !== 1) {
      await pool.execute(
        'INSERT INTO audit_logs (actor, action, details) VALUES (?, ?, ?)',
        [username, 'LOGIN_FAILED', 'Account deactivated']
      );
      return res.status(401).json({ success: false, message: 'Account is deactivated' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      await pool.execute(
        'INSERT INTO audit_logs (actor, action, details) VALUES (?, ?, ?)',
        [username, 'LOGIN_FAILED', 'Invalid password']
      );
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    await pool.execute(
      'INSERT INTO audit_logs (actor, action, details) VALUES (?, ?, ?)',
      [username, 'LOGIN', 'User logged in successfully']
    );

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        is_admin: user.role === 'admin'
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const { username } = req.body;
    if (username) {
      await pool.execute(
        'INSERT INTO audit_logs (actor, action, details) VALUES (?, ?, ?)',
        [username, 'LOGOUT', 'User logged out']
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/check-session', (req, res) => {
  res.json({ logged_in: false });
});

// ============================================
// HEALTH & BOOTSTRAP ENDPOINTS
// ============================================

app.get("/api/health", async (_q, r) => {
  try {
    await pool.query("SELECT 1");
    r.json({
      ok: true,
      database: process.env.DB_NAME || "defaultdb",
      tables: [...tables, "sale_items", "users", "settings", "audit_logs"]
    });
  } catch (e) {
    console.error("Health check failed:", e);
    r.status(503).json({ ok: false, error: "MySQL connection failed", details: e.message });
  }
});

app.get("/api/bootstrap", async (_q, r) => {
  try {
    const data = {};
    for (const t of tables) data[t] = await readTable(t);
    r.json({ data, empty: Object.values(data).every(a => a.length === 0) });
  } catch (e) {
    console.error("Bootstrap error:", e);
    r.status(500).json({ error: "Could not load database records", details: e.message });
  }
});

app.put("/api/sync", async (q, r) => {
  const data = q.body?.data;
  if (!data || typeof data !== "object") return r.status(400).json({ error: "Missing data" });
  
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    for (const t of tables) {
      if (Object.hasOwn(data, t)) await writeTable(c, t, data[t]);
    }
    await c.execute(
      "INSERT INTO audit_logs(actor,action,table_name,details) VALUES(?,?,?,?)",
      ["system", "SYNC", "multiple", "Frontend data synchronized"]
    );
    await c.commit();
    r.json({ ok: true });
  } catch (e) {
    await c.rollback();
    console.error("Sync error:", e);
    r.status(400).json({ error: e.message });
  } finally {
    c.release();
  }
});

app.get("/api/table-counts", async (_q, r) => {
  try {
    const out = {};
    for (const t of [...tables, "sale_items", "users", "settings", "audit_logs"]) {
      const [a] = await pool.query(`SELECT COUNT(*) n FROM \`${t}\``);
      out[t] = a[0].n;
    }
    r.json(out);
  } catch (e) {
    console.error("Table counts error:", e);
    r.status(500).json({ error: "Count query failed" });
  }
});

// ============================================
// PRODUCT API
// ============================================

app.get("/api/products", async (req, res) => {
  try {
    const products = await readTable("products");
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const { name, category, price, stock, image } = req.body;

    if (!name || price === undefined || stock === undefined) {
      return res.status(400).json({ error: "Name, price, and stock quantity are required" });
    }

    const id = `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const productData = {
      id,
      name,
      category: category || "",
      price: Number(price) || 0,
      stock: Number(stock) || 0,
      image: image || null
    };

    await pool.execute(
      "INSERT INTO products(id, name, category, price, stock, data_json) VALUES(?,?,?,?,?,?)",
      [id, name, productData.category, productData.price, productData.stock, JSON.stringify(productData)]
    );

    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      ["system", "CREATE", "products", id, `Product created: ${name}`]
    );

    res.json({ success: true, id, message: "Product created successfully" });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, price, stock } = req.body;

    if (!name || price === undefined || stock === undefined) {
      return res.status(400).json({ error: "Name, price, and stock quantity are required" });
    }

    const [rows] = await pool.execute("SELECT data_json FROM products WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    const existing = (typeof rows[0].data_json === "string" ? JSON.parse(rows[0].data_json) : rows[0].data_json) || {};

    const updated = {
      ...existing,
      id,
      name,
      category: category || "",
      price: Number(price) || 0,
      stock: Number(stock) || 0,
      image: Object.hasOwn(req.body, "image") ? (req.body.image || null) : (existing.image || null)
    };

    await pool.execute(
      "UPDATE products SET name = ?, category = ?, price = ?, stock = ?, data_json = ? WHERE id = ?",
      [updated.name, updated.category, updated.price, updated.stock, JSON.stringify(updated), id]
    );

    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      ["system", "UPDATE", "products", id, `Product updated: ${name}`]
    );

    res.json({ success: true, message: "Product updated successfully" });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute("SELECT id FROM products WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    await pool.execute("DELETE FROM products WHERE id = ?", [id]);

    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      ["system", "DELETE", "products", id, "Product deleted"]
    );

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

// ============================================
// EXPENSES API
// ============================================

app.get("/api/expenses", async (req, res) => {
  try {
    const expenses = await readTable("expenses");
    res.json(expenses);
  } catch (error) {
    console.error("Error fetching expenses:", error);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

app.post("/api/expenses", async (req, res) => {
  try {
    const { title, amount, category, date, createdBy } = req.body;

    if (!title || !String(title).trim() || !(Number(amount) > 0)) {
      return res.status(400).json({ error: "A title and an amount greater than 0 are required" });
    }

    const id = `exp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const expenseData = {
      id,
      title: String(title).trim(),
      amount: Number(amount),
      category: category || "Other",
      date: date || new Date().toISOString().split("T")[0],
      createdBy: createdBy || "system"
    };

    await pool.execute(
      "INSERT INTO expenses(id, title, amount, expense_date, data_json) VALUES(?,?,?,?,?)",
      [id, expenseData.title, expenseData.amount, expenseData.date, JSON.stringify(expenseData)]
    );

    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      [expenseData.createdBy, "CREATE", "expenses", id, `Expense logged: ${expenseData.title} (${expenseData.amount})`]
    );

    res.json({ success: true, id, expense: expenseData });
  } catch (error) {
    console.error("Error creating expense:", error);
    res.status(500).json({ error: "Failed to save expense" });
  }
});

app.delete("/api/expenses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute("SELECT id FROM expenses WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Expense not found" });
    }

    await pool.execute("DELETE FROM expenses WHERE id = ?", [id]);
    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      ["system", "DELETE", "expenses", id, "Expense deleted"]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting expense:", error);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

// ============================================
// TEAM MEMBERS API
// ============================================

app.get("/api/team", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM team_members ORDER BY name");
    const members = rows.map(r => ({
      ...r,
      data_json: typeof r.data_json === "string" ? JSON.parse(r.data_json) : r.data_json
    }));
    res.json(members);
  } catch (error) {
    console.error("Error fetching team:", error);
    res.status(500).json({ error: "Failed to fetch team members" });
  }
});

app.post("/api/team", async (req, res) => {
  try {
    const { name, role, isAdmin, icon, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const id = `tm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const memberData = {
      id,
      name,
      role: role || "Team Member",
      isAdmin: isAdmin || false,
      icon: icon || "fa-user",
      color: color || "blue"
    };

    await pool.execute(
      "INSERT INTO team_members(id, name, role, is_admin, data_json, icon, color) VALUES(?,?,?,?,?,?,?)",
      [id, name, memberData.role, isAdmin ? 1 : 0, JSON.stringify(memberData), memberData.icon, memberData.color]
    );

    res.json({ success: true, id, member: memberData });
  } catch (error) {
    console.error("Error creating team member:", error);
    res.status(500).json({ error: "Failed to create team member" });
  }
});

app.delete("/api/team/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute("DELETE FROM team_members WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting team member:", error);
    res.status(500).json({ error: "Failed to delete team member" });
  }
});

// ============================================
// CUSTOMERS API
// ============================================

app.get("/api/customers", async (req, res) => {
  try {
    const customers = await readTable("customers");
    res.json(customers);
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

app.post("/api/customers", async (req, res) => {
  try {
    const { name, phone, email } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const id = `cust-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const customerData = { id, name, phone: phone || "", email: email || "" };

    await pool.execute(
      "INSERT INTO customers(id, name, phone, email, data_json) VALUES(?,?,?,?,?)",
      [id, name, customerData.phone, customerData.email, JSON.stringify(customerData)]
    );

    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      ["system", "CREATE", "customers", id, `Customer created: ${name}`]
    );

    res.json({ success: true, id, customer: customerData });
  } catch (error) {
    console.error("Error creating customer:", error);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

app.delete("/api/customers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute("DELETE FROM customers WHERE id = ?", [id]);
    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      ["system", "DELETE", "customers", id, "Customer deleted"]
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting customer:", error);
    res.status(500).json({ error: "Failed to delete customer" });
  }
});

// ============================================
// SUPPLIERS API
// ============================================

app.get("/api/suppliers", async (req, res) => {
  try {
    const suppliers = await readTable("suppliers");
    res.json(suppliers);
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    res.status(500).json({ error: "Failed to fetch suppliers" });
  }
});

app.post("/api/suppliers", async (req, res) => {
  try {
    const { name, contact } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const id = `supp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const supplierData = { id, name, contact: contact || "" };

    await pool.execute(
      "INSERT INTO suppliers(id, name, contact, data_json) VALUES(?,?,?,?)",
      [id, name, supplierData.contact, JSON.stringify(supplierData)]
    );

    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      ["system", "CREATE", "suppliers", id, `Supplier created: ${name}`]
    );

    res.json({ success: true, id, supplier: supplierData });
  } catch (error) {
    console.error("Error creating supplier:", error);
    res.status(500).json({ error: "Failed to create supplier" });
  }
});

app.delete("/api/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute("DELETE FROM suppliers WHERE id = ?", [id]);
    await pool.execute(
      "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
      ["system", "DELETE", "suppliers", id, "Supplier deleted"]
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting supplier:", error);
    res.status(500).json({ error: "Failed to delete supplier" });
  }
});

// ============================================
// SALES API
// ============================================

app.get("/api/sales", async (req, res) => {
  try {
    const sales = await readTable("sales");
    res.json(sales);
  } catch (error) {
    console.error("Error fetching sales:", error);
    res.status(500).json({ error: "Failed to fetch sales" });
  }
});

app.post("/api/sales", async (req, res) => {
  try {
    const { date, customer, worker, paymentMethod, items, total } = req.body;

    const id = `VT-${Date.now()}`;
    const saleData = {
      id,
      date: date || new Date().toISOString().split("T")[0],
      customer: customer || "Walk-in Customer",
      worker: worker || "System",
      paymentMethod: paymentMethod || "Cash",
      items: items || [],
      total: Number(total) || 0
    };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        "INSERT INTO sales(id, sale_date, customer, worker, payment_method, total, data_json) VALUES(?,?,?,?,?,?,?)",
        [id, saleData.date, saleData.customer, saleData.worker, saleData.paymentMethod, saleData.total, JSON.stringify(saleData)]
      );

      for (const item of (items || [])) {
        await conn.execute(
          "INSERT INTO sale_items(sale_id, product_id, product_name, quantity, unit_price) VALUES(?,?,?,?,?)",
          [id, String(item.id), item.name, Number(item.qty), Number(item.price)]
        );

        // Update product stock
        if (item.id) {
          await conn.execute(
            "UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?",
            [Number(item.qty), String(item.id)]
          );
        }
      }

      await conn.execute(
        "INSERT INTO audit_logs(actor, action, table_name, record_id, details) VALUES(?,?,?,?,?)",
        [worker, "CREATE", "sales", id, `Sale completed: ${saleData.customer} - Ksh ${saleData.total}`]
      );

      await conn.commit();
      res.json({ success: true, id, sale: saleData });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Error creating sale:", error);
    res.status(500).json({ error: "Failed to create sale" });
  }
});

// ============================================
// START SERVER
// ============================================

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Visiontec server running at http://localhost:${PORT}`);
    console.log(`📊 Connected to Aiven MySQL database: defaultdb`);
  });
}).catch(e => {
  console.error("❌ MySQL setup failed:", e.message);
  process.exit(1);
});