@ui @demo
Feature: Customer Portal — AI Detection Sandbox
  A self-contained local test page used to validate the AI Failure Intelligence
  Engine. Run the "baseline" scenario first to build interaction snapshots in the
  DB, then remove a section from test-pages/ai-test-app.html and re-run to
  trigger AI-powered failure analysis.

  # ─────────────────────────────────────────────────────────────────────────────
  # STEP 1 — Run this scenario first (on the UNMODIFIED page).
  #           It walks through every section so every locator gets a snapshot.
  #           All interactions are stored in ai_interaction_snapshots.
  # ─────────────────────────────────────────────────────────────────────────────
  @baseline
  Scenario: Full portal journey — builds AI baseline snapshots
    Given I open the customer portal test page
    When I sign in with username "testuser" and password "Test@1234"
    And I update my profile with name "Alice Demo" email "alice@test.com" phone "0123456789" department "qa" and employee id "EMP-0042"
    And I add "Wireless Headphones" to the cart
    And I add "Smart Watch" to the cart
    And I add "USB-C Hub" to the cart
    And I apply a coupon code
    And I proceed to checkout
    And I pay with card "4111 1111 1111 1111" expiry "12/27" cvv "123" holder "Alice Demo" country "MY" and zip "50480"
    Then the order should be confirmed
    And the order ID should be generated

  # ─────────────────────────────────────────────────────────────────────────────
  # STEP 2 — Open test-pages/ai-test-app.html, REMOVE the entire
  #           "SECTION 3 — PRODUCT CATALOG" block, save, then run this scenario.
  #           The "Add Wireless Headphones to cart" step will fail.
  #           The AI engine compares the stored snapshot (old info) against the
  #           live DOM (new info) and reports what changed in the Allure report.
  # ─────────────────────────────────────────────────────────────────────────────
  @regression
  Scenario: Portal journey after product section removal — triggers AI detection
    Given I open the customer portal test page
    When I sign in with username "testuser" and password "Test@1234"
    And I update my profile with name "Alice Demo" email "alice@test.com" phone "0123456789" department "qa" and employee id "EMP-0042"
    And I add "Wireless Headphones" to the cart
    And I add "Smart Watch" to the cart
    And I proceed to checkout
    And I pay with card "4111 1111 1111 1111" expiry "12/27" cvv "123" holder "Alice Demo" country "MY" and zip "50480"
    Then the order should be confirmed

  # ─────────────────────────────────────────────────────────────────────────────
  # Login-only smoke — useful for a quick "is the page up?" check
  # ─────────────────────────────────────────────────────────────────────────────
  @smoke
  Scenario: Login section is visible and interactive
    Given I open the customer portal test page
    When I sign in with username "smokeuser" and password "Smoke@999"
    Then the portal page should be loaded

  # ─────────────────────────────────────────────────────────────────────────────
  # Profile-only test — useful when Section 2 is the removal target
  # ─────────────────────────────────────────────────────────────────────────────
  @profile
  Scenario: Profile form can be filled and saved
    Given I open the customer portal test page
    When I sign in with username "profileuser" and password "Profile@1"
    And I update my profile with name "Bob Tester" email "bob@test.com" phone "0112223344" department "engineering" and employee id "EMP-0099"
    Then the portal page should be loaded

  # ─────────────────────────────────────────────────────────────────────────────
  # Payment-only test — useful when Section 5 is the removal target
  # ─────────────────────────────────────────────────────────────────────────────
  @payment
  Scenario: Payment form accepts valid card details
    Given I open the customer portal test page
    When I sign in with username "payuser" and password "Pay@1234"
    And I proceed to checkout
    And I pay with card "5500 0000 0000 0004" expiry "09/26" cvv "456" holder "Charlie Pay" country "SG" and zip "018989"
    Then the order should be confirmed
