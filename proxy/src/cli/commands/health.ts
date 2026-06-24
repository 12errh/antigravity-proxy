interface HealthOptions {
  json?: boolean;
}

export async function healthCommand(opts: HealthOptions): Promise<void> {
  try {
    const res = await fetch('http://localhost:4000/api/health');
    const data = await res.json();

    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log('\n==> Health Check');
    console.log(`  Status:    ${data.status}`);
    console.log(`  Uptime:    ${Math.floor(data.uptime)}s`);
    console.log(`  Timestamp: ${data.timestamp}`);
    console.log('');
  } catch (e: any) {
    if (opts.json) {
      console.log(JSON.stringify({ status: 'error', error: e.message }));
    } else {
      console.error(`\n  XX Cannot reach proxy: ${e.message}`);
      console.error('  Is the proxy running? Try `antigravity start`');
    }
    process.exit(1);
  }
}
