<?php require_once('config.php'); ?>

<?php
/*
Name: Gregory Hablutzel, Timmy Roma, Ella Gainey
Class: TCSS445-DB Fall-20 Al-Masri
Assignment: Group Assignment Phase 3
Description:
 - This PHP file contains the main "SpiritPokemonQueries" page for Kanto Spirit.
 - Displays images of in-game pokemon spirit pokemon lore.
 - Has a button that allows the user to proceed to the spirit pokemon query.
 */
?>

<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kanto Spirit</title>
        <link rel="icon" href="/groupAssignment/images/KantoSpirit2.png">
        <link rel="stylesheet" href="https://bootswatch.com/4/superhero/bootstrap.min.css">
        <!-- local css overrides -->
        <link rel="stylesheet" href="/groupAssignment/css/overrides.css">

        <style>
            /* styling for images*/
            img {
                display: block;
                margin-left: auto;
                margin-right: auto;
            }

            /* styling for button div*/
            .container {
                height: 200px;
                position: relative;
            }

            /* Styling for images of queries above buttons (General and Visual queries)*/
            .center {
                margin: 0;
                position: absolute;
                top: 50%;
                left: 50%;
                -ms-transform: translate(-50%, -50%);
                transform: translate(-50%, -50%);
            }
        </style>
    </head>
    <body>
        <!-- START -- Add HTML code for the top menu section (navigation bar) -->
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
            <style>
                /* Add Local Pokemon Fonts */


                /* NavBar "KantoSpirit" font*/
                .navbar-brand {
                    font-family: PocketMonk;
                }
                /* NavBar Page Selection Header Font (Home, Spirit Pokemon Queries,...,About)*/
                .nav-item {
                    font-family: Hisel;
                    font-size: 180%;
                }

                /* styling for button div*/
                .container {
                    font-family: Hisel;
                    font-size: 200%;
                }

                /* button styling*/
                .btn
                {
                    margin-left: 20px;
                    margin-right: 20px;
                    background: #212020;
                    color: #e3e3e3;
                    font-size: 150%;
                    border: 10px solid #76608a; /* Green */
                    border-radius: 10px;
                    display: inline-block;

                }
                
                /* button hover styling */
                .btn:hover {
                    border: 10px solid black; /* Green */
                    background:  gray;
                    background-color: gray; /* Green */
                    color: white;
                }

                /* button styling */
                .button
                {
                    margin-left: 20px;
                    margin-right: 20px;
                    background: #212020;
                    color: #e3e3e3;
                    font-size: 150%;
                    border: 10px solid #76608a; /* Green */
                    border-radius: 10px;
                    display: inline-block;
                    height: 70px;

                }

                /* button hover styling */
                .button:hover {
                    border: 10px solid black; /* Green */
                    background:  gray;
                    background-color: gray; /* Green */
                    color: white;
                }

                /* row formatting*/
                .row {
                    display: flex;
                }

                /* column formatting*/ 
                .column {
                    flex: 50%;
                    padding: 5px;
                }

                /* customize size of spirit image */
                .spiritImage
                {
                    width = 300px;
                }

                /* customize size of spirit query button */
                .button-spirit
                {
                    flex: 30%;
                    padding: 5px;
                }

                /* row formatting */
                .row {
                    display: flex;
                    justify-content: center;
                }

                /* horizontal spacing of spirit query button*/
                .column-spirit-button {
                    display: flex;
                    justify-content: center;
                }

            </style>
            <a class="navbar-brand" href="#">Kanto Spirit</a>
            <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarColor02" aria-
                    controls="navbarColor02" aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarColor02">
                <ul class="navbar-nav mr-auto">
                    <li class="nav-item">
                        <a class="nav-link" href="index.php">Home
                            <span class="sr-only">(current)</span>
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link active" href="SpiritPokemonQueries.php">Spirit Pokemon Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="GeneralQueries.php">General Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="VisualQueries.php">Visual Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="About.php">About</a>
                    </li>
                </ul>
            </div>
        </nav>
        <!-- END -- Add HTML code for the top menu section (navigation bar) -->

        <div class="row">
            <div class="column">
                <img src="/groupAssignment/images/site/spirit/astrology/personalityAssesment1.jpg" alt="Logo" class="spiritImage" >
            </div>
            <div class="column">
                <img src="/groupAssignment/images/site/spirit/astrology/personalityAssesment2.jpg" alt="Logo" class="spiritImage">
            </div>
        </div>

        <div class="spritRow">
            <a href="Sign.html">
            <div class="column-spirit-button">
                <button class="button">Search By Astrology Sign And Emotion</button>
            </div>
        </div>
    </body>
</html>