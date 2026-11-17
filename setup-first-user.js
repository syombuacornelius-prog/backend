const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function setupFirstUser() {
  console.log('🔐 Visiontec First-Time Setup');
  console.log('================================');
  console.log('No users found. Creating first admin account.\n');

  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'visiontec_shop'
  });

  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM users');
    if (rows[0].count > 0) {
      console.log('❌ Users already exist in the system.');
      console.log('If you need to reset access, manually delete from users table.');
      await pool.end();
      return;
    }

    const username = await new Promise((resolve) => {
      rl.question('Enter admin username: ', resolve);
    });

    if (!username || username.trim === '') {
      console.log('❌ Username cannot be empty');
      await pool.end();
      return;
    }

    const password = await new Promise((resolve) => {
      rl.question('Enter admin password: ', resolve);
    });

    if (!password || password.length < 6) {
      console.log('❌ Password must be at least 6 characters');
      await pool.end();
      return;
    }

    const confirmPassword = await new Promise((resolve) => {
      rl.question('Confirm password: ', resolve);
    });

    if (password !== confirmPassword) {
      console.log('❌ Passwords do not match');
      await pool.end();
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.execute(
      'INSERT INTO users (id, username, role, password_hash, is_active) VALUES (?, ?, ?, ?, 1)',
      ['admin-001', username, 'admin', passwordHash]
    );

    console.log('\n✅ Admin user created successfully!');
    console.log(`Username: ${username}`);
    console.log('\n⚠️  IMPORTANT: Remember these credentials. They cannot be recovered if lost.');
    console.log('\nYou can now start the server and login with these credentials.');
    console.log('Run: node server.js\n');

    await pool.end();
    rl.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    rl.close();
  }
}

setupFirstUser();