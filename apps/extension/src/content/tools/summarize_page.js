function summarizePage(maxLength = 200) {
  try {
    const mainContent = document.querySelector('main, article, [role="main"]') || document.body;
    const summary = mainContent.innerText.substring(0, maxLength);

    return {
      success: true,
      summary,
      fullLength: mainContent.innerText.length,
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}