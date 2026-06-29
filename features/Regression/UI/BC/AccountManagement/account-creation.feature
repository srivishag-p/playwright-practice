@ui @account
Feature: Account Creation
  As a BC user
  I want to create a new account
  So that customers can be registered in the system

  @smoke @positive
  Scenario: Successfully create a new account
    Given I am logged in as "bc_user" with password "Celcom123#"
    When I click on New Account
    And I select "Primary" as the contact type
    And I fill in personal details with first name "Srivishag" last name "Automate" and company "Osyte"
    And I fill in address with street "123 Anna Salai" city "Chennai" state "Tamil Nadu" and zip "600001"
    And I select "India" as the country
    And I fill in email "srivishagp@celcomsolutions.com" and phone "9994910076"
    And I click Continue
    And I select the "Charge_Test_REST" plan
    And I click Continue
    Then the account should be created successfully
