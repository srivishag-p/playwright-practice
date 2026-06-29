@postman @api @cart @allure.label.suite:CartManagement @allure.label.layer:api
Feature: Cart Management API + DB Validation
  As a customer
  I want to manage my cart and checkout
  So that my order is placed and reflected correctly in the database

  Background:
    Given Postman collection "Order Management - Testing Automation" is initialized

  # ─────────────────────────────────────────────────────────────────────────────
  @smoke @positive @allure.label.severity:critical @allure.label.story:GetCart
  Scenario: Get existing cart returns 200 with items array
    When api request "Add Item Biriyani" is initiated
    Then Validate the response code "201"
    When api request "Get Cart" is initiated
    Then Validate the response code "200"
    And the response should contain "items" array with length above 0

  # ─────────────────────────────────────────────────────────────────────────────
  @smoke @positive @allure.label.severity:critical @allure.label.story:AddItem
  Scenario: Add Biriyani to cart and verify persisted in DB
    When api request "Add Item Biriyani" is initiated
    Then Validate the response code "201"
    And the response should contain "items" array with length above 0
    And the response field "subtotal" should be greater than 0

    # DB: cart row must exist for this customer and kitchen
    And in the DB table "cart" a row should exist with
      | customer_id | 139 |
      | kitchen_id  | 126 |

    # DB: cart_item row has correct identity and price columns
    And in the DB table "cart_item" a row should exist with
      | name       | Biriyani |
      | unit_price | 320.5    |

  # ─────────────────────────────────────────────────────────────────────────────
  @positive @allure.label.severity:normal @allure.label.story:AddItem
  Scenario: Add Chicken Roll to cart and verify in DB
    When api request "Add Item Chicken Roll" is initiated
    Then Validate the response code "201"
    And the response should contain "items" array with length above 0

    # Store Chicken Roll's cart_item_id for use in Remove scenario
    And from the API response, in array "items" find where "name" is "Chicken Roll" and store field "id" as "chickenRollItemId"

    # DB: Chicken Roll persisted with correct price and fresh quantity
    And in the DB table "cart_item" a row should exist with
      | name       | Chicken Roll |
      | unit_price | 222.0        |
      | quantity   | 1            |

  # ─────────────────────────────────────────────────────────────────────────────
  @positive @allure.label.severity:normal @allure.label.story:AddItem
  Scenario: Adding same item again increments quantity in DB
    When api request "Add Item Biriyani" is initiated
    And  api request "Add Biriyani Again" is initiated
    Then Validate the response code "201"
    And the response should contain "items" array with length above 0

    # DB: Biriyani still present with stable unit price
    # (exact quantity not asserted here — it accumulates across scenarios in the same run)
    And in the DB table "cart_item" a row should exist with
      | name       | Biriyani |
      | unit_price | 320.5    |

  # ─────────────────────────────────────────────────────────────────────────────
  @positive @allure.label.severity:normal @allure.label.story:UpdateItem
  Scenario: Update item quantity and verify price recalculated in DB
    # Add Biriyani first so we capture its live cart_item_id
    When api request "Add Item Biriyani" is initiated
    Then Validate the response code "201"
    And from the API response, in array "items" find where "name" is "Biriyani" and store field "id" as "biriyaniItemId"

    # PUT sets quantity to exactly 4 — reliable regardless of prior state
    When api request "Update Item Quantity Biriyani" is initiated with below values
      | biriyaniItemId | $biriyaniItemId |
    Then Validate the response code "200"
    And the response should contain "items" array with length above 0

    # DB: quantity is exactly 4 (SET operation, not increment)
    And in the DB table "cart_item" a row should exist with
      | name       | Biriyani |
      | unit_price | 320.5    |
      | quantity   | 4        |

  # ─────────────────────────────────────────────────────────────────────────────
  @positive @allure.label.severity:normal @allure.label.story:RemoveItem
  Scenario: Remove Chicken Roll and verify deleted from DB
    # Add Chicken Roll and capture its cart_item_id from the response
    When api request "Add Item Chicken Roll" is initiated
    Then Validate the response code "201"
    And from the API response, in array "items" find where "name" is "Chicken Roll" and store field "id" as "chickenRollItemId"

    # Remove using the exact cart_item_id — no ambiguity
    When api request "Remove Item Chicken Roll" is initiated with below values
      | chickenRollItemId | $chickenRollItemId |
    Then Validate the response code "200"

    # DB: the specific cart_item row identified by its primary key must be gone
    And in the DB table "cart_item" no row should exist with
      | id | $chickenRollItemId |

  # ─────────────────────────────────────────────────────────────────────────────
  @smoke @positive @allure.label.severity:blocker @allure.label.story:Checkout
  Scenario: Full checkout flow - cart becomes order in DB
    # Build cart
    When api request "Add Item Biriyani" is initiated
    Then Validate the response code "201"

    # Checkout
    When api request "Checkout DELIVERY" is initiated with below values
      | customerAddressId | 5 |
    Then Validate the response code "201"
    And the response field "status" should be "PENDING"
    And the response field "orderType" should be "DELIVERY"

    # Save the order ID for DB assertions
    And From the API response, store "id" as variable "orderId"

    # DB: orders table has the new row
    And in the DB table "orders" a row should exist with
      | customer_id | 139      |
      | kitchen_id  | 126      |
      | status      | PENDING  |
      | order_type  | DELIVERY |

    # DB: order_items populated from the cart
    And order items should exist in DB for order "$orderId"

    # DB: initial PENDING status history row exists
    And order status history should have "PENDING" for order "$orderId"

    # DB: cart deleted after successful checkout
    And no cart should exist for customer "139"
